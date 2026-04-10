(function () {
  var COOKIE_KEY = "nexa_cookie_consent";

  document.addEventListener("DOMContentLoaded", function () {
    var banner = document.getElementById("cookie-consent");
    var accept = document.getElementById("cookie-accept");
    var decline = document.getElementById("cookie-decline");

    if (banner && !localStorage.getItem(COOKIE_KEY)) {
      banner.hidden = false;
    }

    function hideBanner() {
      if (banner) banner.hidden = true;
    }

    if (accept) {
      accept.addEventListener("click", function () {
        localStorage.setItem(COOKIE_KEY, "accepted");
        hideBanner();
      });
    }
    if (decline) {
      decline.addEventListener("click", function () {
        localStorage.setItem(COOKIE_KEY, "declined");
        hideBanner();
      });
    }

    document.querySelectorAll(".contact-form").forEach(function (form) {
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        alert("Thank you for reaching out! We will get back to you soon.");
        form.reset();
      });
    });

    var sp = new URLSearchParams(window.location.search);
    if (sp.get("signedIn") === "1") {
      var toast = document.createElement("p");
      toast.className = "signin-toast";
      toast.setAttribute("role", "status");
      toast.textContent = "You’re signed in.";
      document.body.appendChild(toast);
      var path = window.location.pathname + window.location.hash;
      window.history.replaceState({}, "", path);
      setTimeout(function () {
        toast.remove();
      }, 4500);
    }
  });
})();
