#!/usr/bin/env bash
# Disposable educational network only. Never run on a production host.
set -euo pipefail
test "${GITHUB_ACTIONS:-}" = true
test "${TRLKA_COURSE_LAB:-}" = isolated-ci
test "$(id -u)" = 0
lab="${RUNNER_TEMP:?}/trlka-course-lab"
out="${GITHUB_WORKSPACE:?}/output/coursework"
mkdir -p "$lab" "$out" /run/sshd
chmod 755 "$lab"
server=trlka-course-server
client=trlka-course-client
cleanup() {
  for ns in "$server" "$client"; do
    ip netns pids "$ns" 2>/dev/null | xargs -r kill 2>/dev/null || true
    ip netns del "$ns" 2>/dev/null || true
  done
}
trap cleanup EXIT
ip netns add "$server"
ip netns add "$client"
ip link add course-s type veth peer name course-c
ip link set course-s netns "$server"
ip link set course-c netns "$client"
ip -n "$server" addr add 10.222.0.2/24 dev course-s
ip -n "$client" addr add 10.222.0.1/24 dev course-c
ip -n "$server" link set lo up
ip -n "$client" link set lo up
ip -n "$server" link set course-s up
ip -n "$client" link set course-c up
# Neither namespace has a default route or a link to the runner/Internet.
useradd --system --no-create-home --shell /usr/sbin/nologin courseapp
useradd --create-home --shell /bin/bash courseadmin
install -d -m 700 -o courseadmin -g courseadmin /home/courseadmin/.ssh
ssh-keygen -q -t ed25519 -N '' -f "$lab/admin-key"
ssh-keygen -q -t ed25519 -N '' -f "$lab/host-key"
install -m 600 -o courseadmin -g courseadmin "$lab/admin-key.pub" /home/courseadmin/.ssh/authorized_keys
cat > "$lab/sshd_config" <<EOF
Port 2222
ListenAddress 10.222.0.2
HostKey $lab/host-key
PidFile $lab/sshd.pid
AuthorizedKeysFile .ssh/authorized_keys
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
PermitRootLogin no
PermitEmptyPasswords no
UsePAM yes
AllowUsers courseadmin
X11Forwarding no
AllowTcpForwarding no
MaxAuthTries 3
StrictModes yes
EOF
/usr/sbin/sshd -t -f "$lab/sshd_config"
/usr/sbin/sshd -T -f "$lab/sshd_config" | grep -E '^(port|passwordauthentication|kbdinteractiveauthentication|pubkeyauthentication|permitrootlogin|x11forwarding|allowtcpforwarding|maxauthtries) ' > "$out/sshd-effective.txt"
ip netns exec "$server" /usr/sbin/sshd -f "$lab/sshd_config" -E "$lab/sshd.log"
openssl req -x509 -newkey rsa:2048 -nodes -keyout "$lab/tls-key.pem" -out "$lab/tls-cert.pem" -days 1 -subj '/CN=lab.trlka.test' -addext 'subjectAltName=DNS:lab.trlka.test' >/dev/null 2>&1
chown courseapp:courseapp "$lab/tls-key.pem"
chmod 600 "$lab/tls-key.pem"
cat > "$lab/backend.py" <<'PY'
from http.server import BaseHTTPRequestHandler,HTTPServer
class Handler(BaseHTTPRequestHandler):
 def do_GET(self):
  self.send_response(200);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(b'{"status":"ok","fixture":"educational-backend"}')
 def log_message(self,*args):pass
HTTPServer(('127.0.0.1',8790),Handler).serve_forever()
PY
cat > "$lab/proxy.py" <<'PY'
from http.server import BaseHTTPRequestHandler,HTTPServer
from urllib.request import urlopen
import ssl,sys
class Handler(BaseHTTPRequestHandler):
 def do_GET(self):
  data=urlopen('http://127.0.0.1:8790/health',timeout=3).read();self.send_response(200);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(data)
 def log_message(self,*args):pass
server=HTTPServer(('10.222.0.2',8443),Handler)
tls=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER);tls.load_cert_chain(sys.argv[1],sys.argv[2]);server.socket=tls.wrap_socket(server.socket,server_side=True);server.serve_forever()
PY
ip netns exec "$server" runuser -u courseapp -- python3 "$lab/backend.py" > "$lab/backend.log" 2>&1 &
ip netns exec "$server" runuser -u courseapp -- python3 "$lab/proxy.py" "$lab/tls-cert.pem" "$lab/tls-key.pem" > "$lab/proxy.log" 2>&1 &
# A deliberately open dummy database listener lets the firewall test distinguish
# packet filtering from an absent process. This is not a PostgreSQL DBMS.
ip netns exec "$server" runuser -u courseapp -- python3 -m http.server 5432 --bind 10.222.0.2 > "$lab/db-fixture.log" 2>&1 &
ip netns exec "$server" iptables -P INPUT DROP
ip netns exec "$server" iptables -A INPUT -i lo -j ACCEPT
ip netns exec "$server" iptables -A INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
ip netns exec "$server" iptables -A INPUT -s 10.222.0.1/32 -p tcp --dport 2222 -j ACCEPT
ip netns exec "$server" iptables -A INPUT -p tcp --dport 8443 -j ACCEPT
ip netns exec "$server" iptables -A INPUT -p tcp --dport 5432 -j REJECT --reject-with tcp-reset
sleep 2
report="$out/results.txt"
printf 'TRLKA EDUCATIONAL INFRASTRUCTURE LAB\n' > "$report"
date -u +%FT%TZ >> "$report"
grep '^PRETTY_NAME=' /etc/os-release >> "$report"
ssh_opts=(-i "$lab/admin-key" -p 2222 -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile="$lab/known-hosts" -o ConnectTimeout=3)
name=$(ip netns exec "$client" ssh "${ssh_opts[@]}" courseadmin@10.222.0.2 id -un)
test "$name" = courseadmin
printf 'PASS 01 SSH public key login as courseadmin\n' >> "$report"
if ip netns exec "$client" ssh "${ssh_opts[@]}" -o PubkeyAuthentication=no courseadmin@10.222.0.2 true 2>/dev/null; then exit 1; fi
printf 'PASS 02 Password-only SSH login rejected\n' >> "$report"
if ip netns exec "$client" ssh "${ssh_opts[@]}" root@10.222.0.2 true 2>/dev/null; then exit 1; fi
printf 'PASS 03 Root SSH login rejected\n' >> "$report"
ip netns exec "$client" curl --fail --silent --show-error --max-time 5 --noproxy '*' --cacert "$lab/tls-cert.pem" --resolve lab.trlka.test:8443:10.222.0.2 https://lab.trlka.test:8443/health > "$out/health.json"
grep -q '"status":"ok"' "$out/health.json"
printf 'PASS 04 HTTPS through proxy with certificate verification\n' >> "$report"
if ip netns exec "$client" curl --fail --silent --max-time 2 --noproxy '*' http://10.222.0.2:8790/health >/dev/null 2>&1; then exit 1; fi
printf 'PASS 05 Internal backend port unavailable from client\n' >> "$report"
if ip netns exec "$client" curl --fail --silent --max-time 2 --noproxy '*' http://10.222.0.2:5432/ >/dev/null 2>&1; then exit 1; fi
printf 'PASS 06 Firewall rejects externally bound DB port fixture\n' >> "$report"
test "$(stat -c %a "$lab/tls-key.pem")" = 600
if runuser -u courseadmin -- cat "$lab/tls-key.pem" >/dev/null 2>&1; then exit 1; fi
printf 'PASS 07 TLS private key mode 0600 and inaccessible to administrator account without sudo\n' >> "$report"
test "$(getent passwd courseapp | cut -d: -f7)" = /usr/sbin/nologin
printf 'PASS 08 Backend uses noninteractive service account\n' >> "$report"
ip netns exec "$server" iptables -S INPUT > "$out/firewall.txt"
ip netns exec "$server" ss -lnt > "$out/listeners.txt"
ip -n "$server" -brief addr > "$out/network.txt"
ip -n "$client" -brief addr >> "$out/network.txt"
stat -c '%a %U:%G %n' "$lab/tls-key.pem" | sed "s|$lab|LAB_DIR|" > "$out/file-permissions.txt"
getent passwd courseapp courseadmin > "$out/accounts.txt"
cat "$report"
chown -R "${SUDO_USER:-runner}:" "$out"
