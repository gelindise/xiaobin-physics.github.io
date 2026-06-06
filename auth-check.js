(function() {
  var user = localStorage.getItem("currentUser");
  if (!user) {
    var path = window.location.pathname;
    var page = path.substring(path.lastIndexOf('/') + 1) || 'experiments.html';
    window.location.href = "login.html?redirect=" + encodeURIComponent(page);
  }
})();
