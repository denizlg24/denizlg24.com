self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {}
  event.waitUntil(
    self.registration.showNotification(data.title || "Stockwatcher", {
      body: data.body || "",
      icon: "/apple-icon.png",
      badge: "/apple-icon.png",
      tag: data.url || undefined,
      data: { url: data.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(
    event.notification.data?.url || "/",
    self.location.origin,
  );
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windows) => {
        const open = windows.find((client) =>
          client.url.startsWith(url.origin),
        );
        if (open) {
          open.focus();
          return open.navigate(url.href);
        }
        return self.clients.openWindow(url.href);
      }),
  );
});
