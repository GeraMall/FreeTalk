export function hasTurnServer(iceServers: RTCIceServer[]) {
  return iceServers.some((server) => {
    const urls = typeof server.urls === 'string' ? [server.urls] : server.urls;
    return urls.some((url) => /^turns?:/i.test(url));
  });
}
