/* BlackRidge CRM service worker - handles web push notifications. */

self.addEventListener("push", function (event) {
  var data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = {};
  }
  var title = data.title || "BlackRidge CRM";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      icon: "/blackridge-logo.png",
      badge: "/favicon.png",
      tag: data.tag || "blackridge",
      data: { url: data.url || "/admin" },
    })
  );
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  var url = (event.notification.data && event.notification.data.url) || "/admin";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        if (list[i].url.indexOf(url) !== -1 && "focus" in list[i]) {
          return list[i].focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(url);
      }
    })
  );
});
