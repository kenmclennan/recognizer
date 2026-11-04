using Microsoft.Extensions.Hosting;

namespace Shop.Web;

public class OrderWorker : BackgroundService
{
    protected override Task ExecuteAsync(CancellationToken stoppingToken) => Task.CompletedTask;
}
