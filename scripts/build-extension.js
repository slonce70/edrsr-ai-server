// scripts/build-extension.js
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import archiver from 'archiver';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const projectRoot = path.resolve(__dirname, '..');
const extensionDir = path.join(projectRoot, 'extension');
const buildDir = path.join(projectRoot, 'extension-build');

// Defaults (can be overridden via env)
const PROD_API_URL = process.env.EXT_PROD_API_URL || 'https://edrsr-ai-server.onrender.com';
const DEV_API_URL = process.env.EXT_DEV_API_URL || 'http://localhost:4000';

// --- Start of Edit ---
const PROD_WS_URL = process.env.EXT_PROD_WS_URL || 'wss://edrsr-ai-server.onrender.com';
const DEV_WS_URL = process.env.EXT_DEV_WS_URL || 'ws://localhost:4000';

// Load env for future needs (not used to change Supabase creds; Supabase is same for dev/prod)
const serverEnvPath = path.join(projectRoot, 'server/.env');
if (fs.existsSync(serverEnvPath)) dotenv.config({ path: serverEnvPath });
else dotenv.config();

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
// --- End of Edit ---

async function build() {
  try {
    console.log('🚀 Starting extension build for production...');

    // 1. Clean and create build directory
    console.log(`🧹 Cleaning build directory: ${buildDir}`);
    await fs.emptyDir(buildDir);

    // 2. Copy extension files to build directory
    console.log(`📂 Copying files from ${extensionDir} to ${buildDir}`);
    await fs.copy(extensionDir, buildDir);

    // 3. Patch config.js
    console.log(`🔄 Patching config.js with production URLs...`);
    const configPath = path.join(buildDir, 'config.js');
    let configContent = await fs.readFile(configPath, 'utf-8');

    // Patch both HTTP and WebSocket URLs (replace all occurrences)
    const devHttpRe = new RegExp(escapeRegExp(DEV_API_URL), 'g');
    const devWsRe = new RegExp(escapeRegExp(DEV_WS_URL), 'g');
    configContent = configContent.replace(devHttpRe, PROD_API_URL);
    configContent = configContent.replace(devWsRe, PROD_WS_URL);

    // Patch Supabase redirect to production callback
    const devRedirect = `${DEV_API_URL.replace(/\/$/, '')}/auth/callback`;
    const prodRedirect = `${PROD_API_URL.replace(/\/$/, '')}/auth/callback`;
    const devRedirectRe = new RegExp(escapeRegExp(devRedirect), 'g');
    configContent = configContent.replace(devRedirectRe, prodRedirect);

    // Supabase URL/keys НЕ трогаем — одинаковы для dev и prod

    await fs.writeFile(configPath, configContent, 'utf-8');
    console.log('   ✅ Patched config.js');

    // 4. Patch popup.html footer text (remove localhost hint)
    const popupPath = path.join(buildDir, 'popup.html');
    if (await fs.pathExists(popupPath)) {
      let popupHtml = await fs.readFile(popupPath, 'utf-8');
      try {
        const prodOrigin = new URL(PROD_API_URL).origin.replace(/^https?:\/\//, '');
        popupHtml = popupHtml.replace('localhost:4000', prodOrigin);
        await fs.writeFile(popupPath, popupHtml, 'utf-8');
        console.log('   ✅ Patched popup.html footer');
      } catch (e) {
        console.warn('   ⚠️ Could not patch popup.html footer:', e.message);
      }
    }

  // 5. Patch manifest.json
  console.log('🔄 Patching manifest.json for production permissions');
  const manifestPath = path.join(buildDir, 'manifest.json');
  const manifestContent = await fs.readFile(manifestPath, 'utf-8');
  const manifestJson = JSON.parse(manifestContent);

  // Remove localhost and add production host permission
  manifestJson.host_permissions = manifestJson.host_permissions.filter(
      (p) => !p.includes('localhost') && !p.includes('raw.githubusercontent.com')
  );
  manifestJson.host_permissions.push(PROD_API_URL + '/*');

    // Drop unnecessary permissions (lean for review)
    if (Array.isArray(manifestJson.permissions)) {
      manifestJson.permissions = manifestJson.permissions.filter(
        (p) => p !== 'cookies' && p !== 'scripting'
      );
    }

  await fs.writeFile(manifestPath, JSON.stringify(manifestJson, null, 2), 'utf-8');
  console.log('   ✅ Patched manifest.json');

    // 5.1. Download packaged fonts for Unicode PDF
    console.log('🔤 Downloading Noto Sans fonts into build...');
    const fontsDir = path.join(buildDir, 'fonts');
    await fs.ensureDir(fontsDir);
    const { get } = await import('https');
    const fetchAndSave = (url, out) =>
      new Promise((resolve, reject) => {
        get(url, (res) => {
          if (res.statusCode !== 200) {
            reject(new Error(`Failed to download ${url}: HTTP ${res.statusCode}`));
            res.resume();
            return;
          }
          const file = fs.createWriteStream(out);
          res.pipe(file);
          file.on('finish', () => file.close(resolve));
          file.on('error', reject);
        }).on('error', reject);
      });
    await fetchAndSave(
      'https://raw.githubusercontent.com/googlefonts/noto-fonts/main/hinted/ttf/NotoSans/NotoSans-Regular.ttf',
      path.join(fontsDir, 'NotoSans-Regular.ttf')
    );
    await fetchAndSave(
      'https://raw.githubusercontent.com/googlefonts/noto-fonts/main/hinted/ttf/NotoSans/NotoSans-Bold.ttf',
      path.join(fontsDir, 'NotoSans-Bold.ttf')
    );
    console.log('   ✅ Fonts packaged');

    // 6. Create a zip archive for the store
    console.log(`📦 Creating zip archive for Chrome Web Store...`);
    const zipPath = path.join(projectRoot, `edrsr-ai-extension-v${manifestJson.version}.zip`);
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', {
      zlib: { level: 9 }, // Sets the compression level.
    });

    await new Promise((resolve, reject) => {
      output.on('close', resolve);
      archive.on('warning', (err) => {
        if (err.code === 'ENOENT') {
          console.warn(err);
        } else {
          reject(err);
        }
      });
      archive.on('error', reject);

      archive.pipe(output);
      archive.directory(buildDir, false);
      archive.finalize();
    });

    console.log(`   ✅ Archive created at: ${zipPath}`);

    console.log(
      '\n🎉 Build successful! Production-ready extension is in "extension-build" directory.'
    );
  } catch (error) {
    console.error('❌ Build failed:', error);
    process.exit(1);
  }
}

build();
