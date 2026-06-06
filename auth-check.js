(function() {
  var user = localStorage.getItem("currentUser");
  var token = localStorage.getItem("sessionToken");

  if (!user || !token) {
    var path = window.location.pathname;
    var page = path.substring(path.lastIndexOf('/') + 1) || 'experiments.html';
    window.location.href = "login.html?redirect=" + encodeURIComponent(page);
    return;
  }

  var SUPABASE_URL = "https://ruledlbrdqhruotuaxwi.supabase.co";
  var SUPABASE_KEY = "sb_publishable_0eFNMabL5IhHExao6wSE2A_nWbmMEKt";

  fetch(SUPABASE_URL + "/rest/v1/users?username=eq." + encodeURIComponent(user) + "&select=session_token", {
    headers: { "apikey": SUPABASE_KEY, "Authorization": "Bearer " + SUPABASE_KEY }
  })
  .then(function(r) { return r.json(); })
  .then(function(data) {
    if (data && data[0] && data[0].session_token && data[0].session_token !== token) {
      localStorage.removeItem("currentUser");
      localStorage.removeItem("sessionToken");
      window.location.href = "login.html?reason=kicked";
    }
  })
  .catch(function() {});
})();
