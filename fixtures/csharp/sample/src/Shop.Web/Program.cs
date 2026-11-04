var builder = WebApplication.CreateBuilder(args);

builder.Services.AddShop();

builder.Build().Run();
