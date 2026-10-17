using System;
using System.IO;
using System.IO.Compression;
using System.Text;
using System.Threading;

namespace TMinus.Report
{
    /// <summary>
    /// Writes one report: the page template with the session's KSP.log and
    /// profiler records embedded, gzipped, in its inputs block (format 1, see
    /// <c>tools/analyze/src/page/inputs.ts</c>; change both together). Runs on a
    /// thread-pool thread and never touches Unity or <c>Debug.Log</c>: KSP.log has
    /// one unlocked writer, and a second one from this thread would interleave.
    /// The caller polls <see cref="Done"/> on the main thread and logs the outcome.
    /// </summary>
    internal sealed class ReportWriter
    {
        /// <summary>The inputs block's format number (inputs.ts, INPUTS_FORMAT).</summary>
        public const int InputsFormat = 1;

        /// <summary>The template's line the inputs block replaces (inputs.ts, INPUTS_SLOT).</summary>
        public const string InputsSlot = "<!-- TMINUS-INPUTS -->";

        private readonly string _template;
        private readonly string _log;
        private readonly string _jsonl;
        private readonly string _name;
        private volatile bool _done;

        public string OutPath { get; }

        /// <summary>Null when the report was written.</summary>
        public string Error { get; private set; }

        public bool Done => _done;

        /// <summary>Bytes of KSP.log and of the profiler records read, for the log line.</summary>
        public long LogBytes { get; private set; }
        public long JsonlBytes { get; private set; }
        public long PageBytes { get; private set; }

        /// <param name="jsonl">The profiler's records, or null to leave them out.</param>
        /// <param name="name">The session's name in the report: no path, a path would name the user.</param>
        public ReportWriter(string template, string log, string jsonl, string outPath, string name)
        {
            _template = template;
            _log = log;
            _jsonl = jsonl;
            OutPath = outPath;
            _name = name;
        }

        public void Start() => ThreadPool.QueueUserWorkItem(_ => Run());

        private void Run()
        {
            try
            {
                Write();
            }
            catch (Exception e)
            {
                Error = $"{e.GetType().Name}: {e.Message}";
            }
            finally
            {
                _done = true;
            }
        }

        private void Write()
        {
            var template = File.ReadAllText(_template, Encoding.UTF8);
            var at = template.IndexOf(InputsSlot, StringComparison.Ordinal);
            if (at < 0 || template.IndexOf(InputsSlot, at + 1, StringComparison.Ordinal) >= 0)
                throw new InvalidDataException("the report template must have exactly one inputs slot");

            var log = ReadShared(_log);
            LogBytes = log.Length;
            byte[] jsonl = null;
            if (_jsonl != null)
            {
                jsonl = ReadShared(_jsonl);
                JsonlBytes = jsonl.Length;
            }

            var block = new StringBuilder(log.Length / 4);
            block.Append("<script type=\"application/json\" id=\"tminus-inputs\">{\"format\":").Append(InputsFormat)
                .Append(",\"name\":\"").Append(JsonText(_name))
                .Append("\",\"log\":\"").Append(Packed(log)).Append('"');
            if (jsonl != null)
                block.Append(",\"jsonl\":\"").Append(Packed(jsonl)).Append('"');
            block.Append("}</script>");

            Directory.CreateDirectory(Path.GetDirectoryName(OutPath));
            var temp = OutPath + ".tmp";
            using (var writer = new StreamWriter(temp, false, new UTF8Encoding(false)))
            {
                writer.Write(template.Substring(0, at));
                writer.Write(block.ToString());
                writer.Write(template.Substring(at + InputsSlot.Length));
            }
            PageBytes = new FileInfo(temp).Length;
            if (File.Exists(OutPath))
                File.Delete(OutPath);
            File.Move(temp, OutPath);
        }

        /// <summary>
        /// The file up to the length it has when opened. KSP keeps KSP.log open for
        /// writing, and the profiler its .jsonl: only a reader that shares write
        /// access can open them. A partial last line is the page's to drop.
        /// </summary>
        private static byte[] ReadShared(string path)
        {
            using (var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
            {
                var bytes = new byte[stream.Length];
                var read = 0;
                while (read < bytes.Length)
                {
                    var n = stream.Read(bytes, read, bytes.Length - read);
                    if (n == 0)
                        break;
                    read += n;
                }
                if (read == bytes.Length)
                    return bytes;
                var shorter = new byte[read];
                Array.Copy(bytes, shorter, read);
                return shorter;
            }
        }

        /// <summary>Gzip, then base64: what the page's <c>gunzipBase64</c> reads.</summary>
        private static string Packed(byte[] bytes)
        {
            using (var memory = new MemoryStream(bytes.Length / 8 + 64))
            {
                using (var gzip = new GZipStream(memory, CompressionMode.Compress, true))
                    gzip.Write(bytes, 0, bytes.Length);
                return Convert.ToBase64String(memory.GetBuffer(), 0, (int)memory.Length);
            }
        }

        /// <summary>A JSON string's content, with "&lt;" escaped so no text can end the script element.</summary>
        private static string JsonText(string text)
        {
            var b = new StringBuilder(text.Length);
            foreach (var c in text)
            {
                if (c == '"' || c == '\\')
                    b.Append('\\').Append(c);
                else if (c < 0x20 || c == '<')
                    b.Append("\\u").Append(((int)c).ToString("x4"));
                else
                    b.Append(c);
            }
            return b.ToString();
        }
    }
}
