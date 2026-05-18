const http = require('http');
const fs = require('fs');
const path = require('path');

const server = http.createServer((req, res) => {
  let urlPath = req.url;
  if (urlPath === '/' || urlPath === '/test_reddit_mock.html') {
    urlPath = '/test_reddit_mock.html';
  }
  
  const filePath = path.join(__dirname, urlPath);
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('File not found');
      return;
    }
    
    let contentType = 'text/html';
    if (urlPath.endsWith('.svg')) {
      contentType = 'image/svg+xml';
    } else if (urlPath.endsWith('.css')) {
      contentType = 'text/css';
    }
    
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

server.listen(8080, '127.0.0.1', () => {
  console.log('Static server running at http://localhost:8080/');
});
