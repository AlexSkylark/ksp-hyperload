using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;

namespace HyperLoad.Profiler
{
    /// <summary>
    /// Builds one JSON object on one line. Hand-rolled so the profiler has no
    /// dependencies; only supports what the profiler writes.
    /// </summary>
    internal sealed class JsonLine
    {
        private readonly StringBuilder _sb = new StringBuilder(256);
        private bool _first;

        public JsonLine Begin()
        {
            _sb.Length = 0;
            _sb.Append('{');
            _first = true;
            return this;
        }

        public string End()
        {
            _sb.Append('}');
            return _sb.ToString();
        }

        public JsonLine Field(string key, string value)
        {
            Key(key);
            if (value == null)
                _sb.Append("null");
            else
                AppendString(value);
            return this;
        }

        public JsonLine Field(string key, double value)
        {
            Key(key);
            _sb.Append(value.ToString("0.###", CultureInfo.InvariantCulture));
            return this;
        }

        public JsonLine Field(string key, long value)
        {
            Key(key);
            _sb.Append(value.ToString(CultureInfo.InvariantCulture));
            return this;
        }

        public JsonLine Field(string key, bool value)
        {
            Key(key);
            _sb.Append(value ? "true" : "false");
            return this;
        }

        /// <summary>Writes null when the value is unknown.</summary>
        public JsonLine Field(string key, bool? value)
        {
            if (value.HasValue)
                return Field(key, value.Value);
            Key(key);
            _sb.Append("null");
            return this;
        }

        public JsonLine Field(string key, IEnumerable<string> values)
        {
            Key(key);
            _sb.Append('[');
            var first = true;
            foreach (var value in values)
            {
                if (!first)
                    _sb.Append(',');
                first = false;
                AppendString(value);
            }
            _sb.Append(']');
            return this;
        }

        private void Key(string key)
        {
            if (!_first)
                _sb.Append(',');
            _first = false;
            AppendString(key);
            _sb.Append(':');
        }

        private void AppendString(string value)
        {
            _sb.Append('"');
            foreach (var c in value)
            {
                switch (c)
                {
                    case '"': _sb.Append("\\\""); break;
                    case '\\': _sb.Append("\\\\"); break;
                    case '\n': _sb.Append("\\n"); break;
                    case '\r': _sb.Append("\\r"); break;
                    case '\t': _sb.Append("\\t"); break;
                    default:
                        if (c < 0x20)
                            _sb.Append("\\u").Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
                        else
                            _sb.Append(c);
                        break;
                }
            }
            _sb.Append('"');
        }
    }

    /// <summary>
    /// Writes one run's measurements to a JSON Lines file (one record per line).
    /// Times are milliseconds since process start.
    /// </summary>
    internal sealed class JsonlWriter : IDisposable
    {
        private readonly StreamWriter _writer;
        private readonly JsonLine _line = new JsonLine();

        public string FilePath { get; }

        public JsonlWriter(string directory)
        {
            Directory.CreateDirectory(directory);
            FilePath = Path.Combine(directory, $"run-{DateTime.Now:yyyyMMdd-HHmmss}.jsonl");
            _writer = new StreamWriter(FilePath, false, new UTF8Encoding(false));
        }

        /// <summary>Writes a free-form record built by <paramref name="build"/>.</summary>
        public void WriteRecord(Action<JsonLine> build)
        {
            _line.Begin();
            build(_line);
            _writer.WriteLine(_line.End());
        }

        public void WriteEvents(List<ProfilerEvent> events)
        {
            foreach (var e in events)
                _writer.WriteLine(Format(e));
            _writer.Flush();
        }

        public void Flush() => _writer.Flush();

        public void Dispose() => _writer.Dispose();

        private string Format(ProfilerEvent e)
        {
            _line.Begin()
                .Field("t", ProfilerClock.ToMsSinceProcessStart(e.StartTicks))
                .Field("kind", KindName(e.Kind))
                .Field("name", e.Name);

            if (e.Detail != null)
                _line.Field("detail", e.Detail);

            switch (e.Kind)
            {
                case EventKind.Span:
                    _line.Field("dur", ProfilerClock.DurationMs(e.StartTicks, e.EndTicks));
                    if (e.Approximate)
                        _line.Field("approx", true);
                    break;
                case EventKind.Counter:
                    _line.Field("value", e.Value);
                    break;
                case EventKind.Memory:
                    var m = e.Memory;
                    _line.Field("gcCount", m.Collections)
                        .Field("monoUsed", m.MonoUsedBytes)
                        .Field("monoHeap", m.MonoHeapBytes)
                        .Field("unityAllocated", m.UnityAllocatedBytes);
                    break;
            }

            if (!e.MainThread)
                _line.Field("main", false);

            return _line.End();
        }

        private static string KindName(EventKind kind)
        {
            switch (kind)
            {
                case EventKind.Span: return "span";
                case EventKind.Mark: return "mark";
                case EventKind.Counter: return "counter";
                case EventKind.Memory: return "memory";
                default: return "unknown";
            }
        }
    }
}
