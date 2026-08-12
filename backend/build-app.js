const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

try {
  console.log('1. Building frontend Angular app...');
  execSync('npm run build', { cwd: path.join(__dirname, '..', 'frontend'), stdio: 'inherit' });

  console.log('2. Preparing public directory...');
  const publicPath = path.join(__dirname, 'public');
  if (fs.existsSync(publicPath)) {
    fs.rmSync(publicPath, { recursive: true, force: true });
  }
  fs.mkdirSync(publicPath, { recursive: true });

  console.log('3. Copying frontend build to public...');
  const srcBrowser = path.join(__dirname, '..', 'frontend', 'dist', 'frontend', 'browser');
  if (fs.existsSync(srcBrowser)) {
    fs.cpSync(srcBrowser, publicPath, { recursive: true });
    console.log('Copied static assets successfully.');
  } else {
    throw new Error(`Build output folder not found at: ${srcBrowser}`);
  }

  console.log('4. Bundling backend with esbuild...');
  execSync('npx -y esbuild server.ts --bundle --platform=node --target=node20 --external:better-sqlite3 --alias:node:sqlite=./sqlite-stub.js --outfile=dist/server.js', { stdio: 'inherit' });

  console.log('=== Full App Build Succeeded ===');
} catch (error) {
  console.error('=== App Build Failed ===');
  console.error(error.message || error);
  process.exit(1);
}
