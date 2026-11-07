import { promises as dns } from 'node:dns';
for (const name of ['ns1.reg.ru', 'ns2.reg.ru']) {
  const addresses = await dns.resolve4(name);
  const resolver = new dns.Resolver({ timeout: 3000, tries: 1 });
  resolver.setServers(addresses);
  console.log(
    JSON.stringify({
      nameserver: name,
      a: await resolver.resolve4('trlka.com', { ttl: true }),
      www: await resolver.resolveCname('www.trlka.com'),
    }),
  );
}
