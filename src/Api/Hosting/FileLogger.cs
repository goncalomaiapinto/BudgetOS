namespace Api.Hosting;

/// <summary>
/// Minimal daily log file (logs\orcamento-yyyyMMdd.log) for the installed app, which runs without a console.
/// Levels are filtered by the usual "Logging:LogLevel" configuration.
/// </summary>
public sealed class FileLoggerProvider : ILoggerProvider
{
    private readonly string _folder;
    private readonly Lock _lock = new();

    public FileLoggerProvider(string folder, int keepDays = 30)
    {
        _folder = folder;
        Directory.CreateDirectory(folder);
        foreach (var f in new DirectoryInfo(folder).GetFiles("orcamento-*.log").Where(f => f.LastWriteTime < DateTime.Now.AddDays(-keepDays)))
        {
            try { f.Delete(); } catch (IOException) { /* in use or already gone */ }
        }
    }

    public ILogger CreateLogger(string categoryName) => new FileLogger(this, categoryName);

    public void Dispose() { }

    private void Write(string line)
    {
        lock (_lock)
            File.AppendAllText(Path.Combine(_folder, $"orcamento-{DateTime.Now:yyyyMMdd}.log"), line + Environment.NewLine);
    }

    private sealed class FileLogger(FileLoggerProvider provider, string category) : ILogger
    {
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

        public bool IsEnabled(LogLevel logLevel) => logLevel != LogLevel.None;

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception,
            Func<TState, Exception?, string> formatter)
        {
            var line = $"{DateTime.Now:yyyy-MM-dd HH:mm:ss} [{logLevel}] {category}: {formatter(state, exception)}";
            if (exception is not null) line += Environment.NewLine + exception;
            provider.Write(line);
        }
    }
}
