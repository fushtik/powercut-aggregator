const http = require('http');

const hostname = '0.0.0.0';
const port = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Power Cut Aggregator</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 40px; background: #f5f5f5; }
          h1 { color: #333; }
          .status { background: #4CAF50; color: white; padding: 10px; border-radius: 5px; display: inline-block; }
        </style>
      </head>
      <body>
        <h1>UK Power Cut Aggregator</h1>
        <p class="status">✓ Hello World - Server is running!</p>
        <p>UK Power Outage Monitoring System</p>
        <p><small>Created: ${new Date().toISOString()}</small></p>
      </body>
    </html>
  `);
});

server.listen(port, hostname, () => {
  console.log(`Server running at http://${hostname}:${port}/`);
  console.log(`Press Ctrl+C to stop`);
});
