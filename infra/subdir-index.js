// CloudFront viewer-request function: resolve directory URIs to index.html.
//
// The distribution's origin is the S3 REST endpoint, which has no notion of an
// index document inside a prefix — only DefaultRootObject, and that applies to
// "/" alone. Without this, every app on the domain 403s at its own front door
// while /blaster/index.html serves fine.
//
// Runtime is cloudfront-js-2.0; this stays ES5 so it also runs on 1.0.
function handler(event) {
  var request = event.request;
  var uri = request.uri;

  if (uri.charAt(uri.length - 1) === "/") {
    request.uri = uri + "index.html";
  } else {
    var lastSegment = uri.substring(uri.lastIndexOf("/") + 1);
    // A segment with no dot is a route, not a file: /hugos/stats — which the
    // Next export writes as /hugos/stats/index.html.
    if (lastSegment.indexOf(".") === -1) {
      request.uri = uri + "/index.html";
    }
  }

  return request;
}
