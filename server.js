var Connect = require('connect');

var server = Connect.createServer(
  Connect.logger(), // Log responses to the terminal using Common Log Format.
  Connect.static(__dirname) // Serve all static files in the current dir.
);

server.listen(process.env.PORT || 5000);
