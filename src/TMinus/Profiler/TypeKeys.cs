using System;
using System.Collections.Generic;

namespace TMinus.Profiler
{
    /// <summary>
    /// The key the profiler gives a type: <c>"&lt;assembly&gt;/&lt;full name&gt;"</c>, so the
    /// analyzer can find the mod that ships it. Computed once per type. Thread-safe.
    /// </summary>
    internal static class TypeKeys
    {
        private static readonly Dictionary<Type, string> Keys = new Dictionary<Type, string>();

        public static string Of(Type type)
        {
            lock (Keys)
            {
                if (!Keys.TryGetValue(type, out var key))
                {
                    key = $"{type.Assembly.GetName().Name}/{type.FullName}";
                    Keys.Add(type, key);
                }
                return key;
            }
        }
    }
}
