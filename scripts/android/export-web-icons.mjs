import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(new URL('../../apps/desktop/package.json', import.meta.url));
const iconDirectory = path.join(path.dirname(require.resolve('lucide-react')), '../esm/icons');
const mappings = {
  ArrowBack: 'arrow-left',
  ArrowForward: 'arrow-right',
  ExitToApp: 'log-out',
  Send: 'send',
  AccountBox: 'panel-right',
  Add: 'plus',
  Archive: 'archive',
  AttachFile: 'paperclip',
  AutoAwesome: 'sparkles',
  Bookmark: 'bookmark',
  BugReport: 'bug',
  Call: 'phone-call',
  Category: 'shapes',
  ChatBubbleOutline: 'message-circle',
  Check: 'check',
  CheckCircle: 'circle-check',
  ChevronRight: 'chevron-right',
  Circle: 'circle',
  Close: 'x',
  ContentCopy: 'copy',
  Devices: 'monitor-smartphone',
  Download: 'download',
  Forum: 'messages-square',
  Groups: 'users',
  HeadsetOff: 'headphone-off',
  History: 'history',
  Home: 'door-open',
  Info: 'info',
  Lightbulb: 'lightbulb',
  Link: 'link',
  Logout: 'log-out',
  MeetingRoom: 'door-open',
  Mic: 'mic',
  MicOff: 'mic-off',
  MoreHoriz: 'ellipsis',
  Palette: 'palette',
  PeopleOutline: 'users',
  Person: 'user-round',
  PersonAdd: 'user-round-plus',
  PlayCircle: 'circle-play',
  PushPin: 'pin',
  QrCodeScanner: 'scan-qr-code',
  Restore: 'rotate-ccw',
  SaveAlt: 'download',
  Search: 'search',
  Videocam: 'video',
  VideocamOff: 'video-off',
  Visibility: 'eye',
  VisibilityOff: 'eye-off',
  WorkspacePremium: 'crown',
  ImagePlus: 'image-plus',
  Sticker: 'sticker',
  Smile: 'smile',
  Lock: 'lock-keyhole',
  Store: 'store',
};

function geometry(kind, attrs) {
  const { x = 0, y = 0, width, height, cx, cy, r, rx = 0, ry = rx } = attrs;
  switch (kind) {
    case 'path':
      return attrs.d;
    case 'line':
      return `M${attrs.x1} ${attrs.y1}L${attrs.x2} ${attrs.y2}`;
    case 'polyline':
      return `M${attrs.points.trim().replaceAll(' ', 'L')}`;
    case 'polygon':
      return `M${attrs.points.trim().replaceAll(' ', 'L')}Z`;
    case 'circle':
      return `M${Number(cx) - Number(r)} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;
    case 'rect': {
      const right = Number(x) + Number(width),
        bottom = Number(y) + Number(height);
      return `M${Number(x) + Number(rx)} ${y}H${right - rx}Q${right} ${y} ${right} ${Number(y) + Number(ry)}V${bottom - ry}Q${right} ${bottom} ${right - rx} ${bottom}H${Number(x) + Number(rx)}Q${x} ${bottom} ${x} ${bottom - ry}V${Number(y) + Number(ry)}Q${x} ${y} ${Number(x) + Number(rx)} ${y}Z`;
    }
    default:
      throw new Error(`Unsupported Lucide geometry ${kind}`);
  }
}

const values = Object.entries(mappings).map(([name, source]) => {
  const code = fs.readFileSync(path.join(iconDirectory, `${source}.js`), 'utf8');
  const match = code.match(/const __iconNode = ([\s\S]*?);\s*const /);
  if (!match) throw new Error(`Missing icon ${source}`);
  const nodes = vm.runInNewContext(match[1], Object.create(null), { timeout: 1000 });
  const paths = nodes.map(([kind, attrs]) => JSON.stringify(geometry(kind, attrs)));
  return `    val ${name}: ImageVector by lazy { vector("${source}", listOf(${paths.join(', ')})) }`;
});
const target = new URL(
  '../../apps/android-native/app/src/main/java/io/freetalk/mobile/WebIcons.kt',
  import.meta.url,
);
fs.writeFileSync(
  target,
  `// Generated from the same Lucide icons used by the web client. Run scripts/android/export-web-icons.mjs.\n// Lucide v0.542.0, ISC license in assets/licenses/lucide.txt.\npackage io.freetalk.mobile\n\nimport androidx.compose.ui.graphics.Color\nimport androidx.compose.ui.graphics.SolidColor\nimport androidx.compose.ui.graphics.StrokeCap\nimport androidx.compose.ui.graphics.StrokeJoin\nimport androidx.compose.ui.graphics.vector.ImageVector\nimport androidx.compose.ui.graphics.vector.PathParser\nimport androidx.compose.ui.unit.dp\n\ninternal object WebIcons {\n${values.join('\n')}\n\n    private fun vector(name: String, paths: List<String>): ImageVector {\n        val builder = ImageVector.Builder(name, 24.dp, 24.dp, 24f, 24f)\n        paths.forEach { data ->\n            builder.addPath(pathData = PathParser().parsePathString(data).toNodes(),\n                fill = null, stroke = SolidColor(Color.Black), strokeLineWidth = 1.75f,\n                strokeLineCap = StrokeCap.Round, strokeLineJoin = StrokeJoin.Round)\n        }\n        return builder.build()\n    }\n}\n`,
);
const license = new URL(
  '../../apps/android-native/app/src/main/assets/licenses/lucide.txt',
  import.meta.url,
);
fs.copyFileSync(path.join(iconDirectory, '../../../LICENSE'), license);
console.log(`Exported ${values.length} shared web icons`);
