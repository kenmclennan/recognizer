namespace Sample;

public class LoggingDispatcher : Dispatcher
{
    private readonly Dispatcher inner;

    public LoggingDispatcher(Dispatcher inner)
    {
        this.inner = inner;
    }

    public void Send(string message)
    {
        inner.Send(message);
    }
}
