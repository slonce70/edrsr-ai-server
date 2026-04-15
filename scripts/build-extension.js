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
const serverEnvPath = path.join(projectRoot, 'server/.env');

if (fs.existsSync(serverEnvPath)) {
  dotenv.config({ path: serverEnvPath });
} else {
  dotenv.config();
}

const EXTENSION_BUILD_ENV = String(process.env.EXTENSION_BUILD_ENV || 'development').toLowerCase();
const IS_PROD_LIKE_BUILD =
  EXTENSION_BUILD_ENV === 'production' || EXTENSION_BUILD_ENV === 'staging';
const SHOULD_PACKAGE_ZIP = ['1', 'true', 'yes'].includes(
  String(process.env.PACKAGE_EXTENSION_ZIP || '').toLowerCase()
);

const DEV_DEFAULTS = Object.freeze({
  apiBaseUrl: process.env.EXT_DEV_API_URL || 'http://localhost:4000/api',
  wsUrl: process.env.EXT_DEV_WS_URL || 'ws://localhost:4000',
  supabaseUrl: process.env.EXT_DEV_SUPABASE_URL || 'https://dhgqmkhkptbzlwskktte.supabase.co',
  supabaseAnonKey:
    process.env.EXT_DEV_SUPABASE_ANON_KEY ||
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJodHRwczovL2RoZ3Fta2hrcHRiemx3c2trdHRlLnN1cGFiYXNlLmNvL2F1dGgvdjEiLCJyZWYiOiJkaGdxbWtoa3B0Ynpsd3Nra3R0ZSIsInJvbGUiOiJhbm9uIiwiaWF0IjoxNzUxNDQ5MjY4LCJleHAiOjIwNjcwMjUyNjh9.CHMYGthrxj1-6uNAB29O5M0-8aA1Vaocmh86KAm3W98',
  supabaseRedirectTo:
    process.env.EXT_DEV_SUPABASE_REDIRECT_TO || 'http://localhost:4000/auth/callback',
  devAuthEnabled: ['1', 'true', 'yes'].includes(
    String(
      process.env.EXT_DEV_AUTH_ENABLED || process.env.DEV_AUTH_ENABLED || 'false'
    ).toLowerCase()
  ),
});

function assertEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) {
    throw new Error(`${name} is required for ${EXTENSION_BUILD_ENV} extension builds`);
  }
  return value;
}

function getBuildConfig() {
  if (!IS_PROD_LIKE_BUILD) {
    return DEV_DEFAULTS;
  }

  return {
    apiBaseUrl: assertEnv('EXT_API_URL'),
    wsUrl: assertEnv('EXT_WS_URL'),
    supabaseUrl: assertEnv('EXT_SUPABASE_URL'),
    supabaseAnonKey: assertEnv('EXT_SUPABASE_ANON_KEY'),
    supabaseRedirectTo: assertEnv('EXT_SUPABASE_REDIRECT_TO'),
    devAuthEnabled: false,
  };
}

function replaceConfigProperty(source, name, value) {
  const pattern = new RegExp(`(export const ${name} =\\s*)'[^']*';`);
  if (!pattern.test(source)) {
    throw new Error(`Could not find config property ${name} in config.js`);
  }
  return source.replace(pattern, `$1${JSON.stringify(value)};`);
}

function replaceBuildEnv(source, value) {
  const pattern = /const BUILD_ENV = '[^']+';/;
  if (!pattern.test(source)) {
    throw new Error('Could not find BUILD_ENV in config.js');
  }
  return source.replace(pattern, `const BUILD_ENV = ${JSON.stringify(value)};`);
}

function replaceBooleanConfigProperty(source, name, value) {
  const pattern = new RegExp(`(export const ${name} =\\s*)(true|false);`);
  if (!pattern.test(source)) {
    throw new Error(`Could not find boolean config property ${name} in config.js`);
  }
  return source.replace(pattern, `$1${value ? 'true' : 'false'};`);
}

function scrubString(content) {
  content = content.replace(
    /https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/pdfobject\/2\.1\.1\/pdfobject\.min\.js/g,
    'pdfobject.min.js'
  );
  return content.replace(/https?:\/\/[\w.-]+/g, (match) => match.replace('://', ': //'));
}

async function ensureHermeticFonts() {
  const requiredFonts = ['NotoSans-Regular.ttf', 'NotoSans-Bold.ttf'];
  const fontDir = path.join(extensionDir, 'fonts');

  for (const fontName of requiredFonts) {
    const fontPath = path.join(fontDir, fontName);
    if (!(await fs.pathExists(fontPath))) {
      throw new Error(
        `Missing vendored font ${fontName}. Add it under extension/fonts before building.`
      );
    }
  }
}

async function patchConfig(config) {
  console.log(`🔄 Patching config.js for ${EXTENSION_BUILD_ENV}...`);
  const configPath = path.join(buildDir, 'config.js');
  let configContent = await fs.readFile(configPath, 'utf-8');

  configContent = replaceBuildEnv(configContent, EXTENSION_BUILD_ENV);
  configContent = replaceConfigProperty(configContent, 'API_BASE_URL', config.apiBaseUrl);
  configContent = replaceConfigProperty(configContent, 'WS_URL', config.wsUrl);
  configContent = replaceConfigProperty(configContent, 'SUPABASE_URL', config.supabaseUrl);
  configContent = replaceConfigProperty(configContent, 'SUPABASE_ANON_KEY', config.supabaseAnonKey);
  configContent = replaceConfigProperty(
    configContent,
    'SUPABASE_REDIRECT_TO',
    config.supabaseRedirectTo
  );
  configContent = replaceBooleanConfigProperty(
    configContent,
    'DEV_AUTH_ENABLED',
    config.devAuthEnabled
  );

  await fs.writeFile(configPath, configContent, 'utf-8');
  console.log('   ✅ Patched config.js');
}

async function patchPopupFooter(config) {
  const popupPath = path.join(buildDir, 'popup.html');
  if (!(await fs.pathExists(popupPath))) return;

  let popupHtml = await fs.readFile(popupPath, 'utf-8');
  const apiHost = new URL(config.apiBaseUrl).host;
  popupHtml = popupHtml.replace(/localhost:4000/g, apiHost);
  await fs.writeFile(popupPath, popupHtml, 'utf-8');
  console.log('   ✅ Patched popup.html footer');
}

async function patchManifest(config) {
  console.log('🔄 Patching manifest.json...');
  const manifestPath = path.join(buildDir, 'manifest.json');
  const rootPackagePath = path.join(projectRoot, 'package.json');
  const sourceManifestPath = path.join(extensionDir, 'manifest.json');

  const manifestJson = JSON.parse(await fs.readFile(manifestPath, 'utf-8'));
  const rootPkg = JSON.parse(await fs.readFile(rootPackagePath, 'utf-8'));
  const sourceManifest = JSON.parse(await fs.readFile(sourceManifestPath, 'utf-8'));

  if (sourceManifest.version !== rootPkg.version) {
    throw new Error(
      `extension/manifest.json version (${sourceManifest.version}) must match root package.json (${rootPkg.version})`
    );
  }

  const apiOrigin = new URL(config.apiBaseUrl).origin;
  const supabaseOrigin = new URL(config.supabaseUrl).origin;

  manifestJson.version = rootPkg.version;
  manifestJson.host_permissions = Array.from(
    new Set([
      ...(manifestJson.host_permissions || []).filter(
        (permission) =>
          !permission.includes('localhost') &&
          !permission.includes('127.0.0.1') &&
          !permission.includes('raw.githubusercontent.com') &&
          !permission.includes('supabase.co')
      ),
      `${apiOrigin}/*`,
      `${supabaseOrigin}/*`,
    ])
  );

  if (Array.isArray(manifestJson.permissions)) {
    manifestJson.permissions = manifestJson.permissions.filter(
      (permission) => permission !== 'cookies' && permission !== 'scripting'
    );
  }

  await fs.writeFile(manifestPath, JSON.stringify(manifestJson, null, 2) + '\n', 'utf-8');
  console.log(`   ✅ Patched manifest.json (version ${manifestJson.version})`);
  return manifestJson;
}

async function scrubVendorFiles() {
  console.log('🧼 Scrubbing remote URL references in vendor files...');
  const vendorFiles = ['jspdf.umd.min.js', 'html2canvas.min.js', 'marked.min.js']
    .map((file) => path.join(buildDir, file))
    .filter((file) => fs.existsSync(file));

  for (const file of vendorFiles) {
    const before = await fs.readFile(file, 'utf-8');
    const after = scrubString(before);
    if (after !== before) {
      await fs.writeFile(file, after, 'utf-8');
      console.log(`   ✅ Scrubbed ${path.basename(file)}`);
    } else {
      console.log(`   ℹ️  No remote URLs found in ${path.basename(file)}`);
    }
  }
}

async function createArchive(version) {
  console.log('📦 Creating zip archive for Chrome Web Store...');
  const zipPath = path.join(projectRoot, `edrsr-ai-extension-v${version}.zip`);
  const output = fs.createWriteStream(zipPath);
  const archive = archiver('zip', { zlib: { level: 9 } });

  await new Promise((resolve, reject) => {
    output.on('close', resolve);
    archive.on('warning', (error) => {
      if (error.code === 'ENOENT') {
        console.warn(error);
      } else {
        reject(error);
      }
    });
    archive.on('error', reject);
    archive.pipe(output);
    archive.directory(buildDir, false);
    archive.finalize();
  });

  console.log(`   ✅ Archive created at: ${zipPath}`);
}

async function build() {
  try {
    const config = getBuildConfig();

    if (SHOULD_PACKAGE_ZIP && !IS_PROD_LIKE_BUILD) {
      throw new Error('Release zip packaging is only allowed for production/staging builds');
    }

    console.log(`🚀 Starting extension build (${EXTENSION_BUILD_ENV})...`);
    await ensureHermeticFonts();

    console.log(`🧹 Cleaning build directory: ${buildDir}`);
    await fs.emptyDir(buildDir);

    console.log(`📂 Copying files from ${extensionDir} to ${buildDir}`);
    await fs.copy(extensionDir, buildDir);

    await patchConfig(config);
    await patchPopupFooter(config);
    const manifestJson = await patchManifest(config);
    await scrubVendorFiles();
    if (SHOULD_PACKAGE_ZIP) {
      await createArchive(manifestJson.version);
    } else {
      console.log('📦 Skipping zip packaging for non-release build.');
    }

    console.log(
      '\n🎉 Build successful! Unpacked extension is ready in "extension-build" directory.'
    );
  } catch (error) {
    console.error('❌ Build failed:', error);
    process.exit(1);
  }
}

build();
