// CloudFront Function (viewer request) for the web app: any path that is not a file is an Angular
// route, so it gets index.html. /api/* never reaches this function (it has its own behaviour).
function handler(event) {
  var request = event.request;
  var last = request.uri.split('/').pop();
  if (last.indexOf('.') === -1) request.uri = '/index.html';
  return request;
}
