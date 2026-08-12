const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const net = require('net');

let mainWindow;

// Find an available port dynamically to prevent port collisions
function getFreePort() {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.on('error', () => resolve(3000));
    server.listen(0, () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

// Catch all unhandled errors and write to app-error.log in AppData
function setupLogging() {
  const userDataPath = app.getPath('userData');
  if (!fs.existsSync(userDataPath)) {
    fs.mkdirSync(userDataPath, { recursive: true });
  }
  const logFile = path.join(userDataPath, 'app-debug.log');
  const errFile = path.join(userDataPath, 'app-error.log');

  function log(msg) {
    const timestamp = new Date().toISOString();
    const formatted = `[${timestamp}] ${msg}\n`;
    fs.appendFileSync(logFile, formatted);
    console.log(msg);
  }

  function logErr(err) {
    const timestamp = new Date().toISOString();
    const formatted = `[${timestamp}] ERROR: ${err?.stack || err}\n`;
    fs.appendFileSync(errFile, formatted);
    console.error(err);
  }

  process.on('uncaughtException', (err) => logErr(err));
  process.on('unhandledRejection', (err) => logErr(err));

  return { log, logErr, logFile, errFile };
}

function initializeAssets(logger) {
  const userDataPath = app.getPath('userData');
  logger.log(`App Data Directory: ${userDataPath}`);

  // Writable file paths
  const dbDestPath = path.join(userDataPath, 'dev.db');
  const studentsDestPath = path.join(userDataPath, 'students.json');

  // Source files in the app bundle
  const dbSrcPath = path.join(__dirname, 'dev.db');
  const studentsSrcPath = path.join(__dirname, 'students.json');

  // Copy students.json if not present
  if (!fs.existsSync(studentsDestPath)) {
    if (fs.existsSync(studentsSrcPath)) {
      fs.copyFileSync(studentsSrcPath, studentsDestPath);
      logger.log('Copied students.json to writable AppData path.');
    } else {
      fs.writeFileSync(studentsDestPath, '[]');
      logger.log('Created empty students.json fallback.');
    }
  }

  // Copy dev.db if not present
  if (!fs.existsSync(dbDestPath)) {
    if (fs.existsSync(dbSrcPath)) {
      fs.copyFileSync(dbSrcPath, dbDestPath);
      logger.log('Copied dev.db to writable AppData path.');
    } else {
      logger.log('Warning: Source dev.db not found, SQLite database will start blank.');
    }
  }

  // Inject these paths as environment variables for our server to pick up
  process.env.DATABASE_URL = `file:${dbDestPath}`;
  process.env.STUDENTS_JSON_PATH = studentsDestPath;

  // Tell the server where the public (frontend) files are
  const publicDir = path.join(__dirname, 'public');
  process.env.PUBLIC_PATH = publicDir;
}

async function startServerAndWindow() {
  const logger = setupLogging();
  logger.log('Starting Electron app...');

  // 1. Create the window immediately with a dark background so startup feels instantaneous
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 850,
    title: 'CodeTracker Leaderboard',
    icon: path.join(__dirname, 'public', 'favicon.ico'),
    backgroundColor: '#0f172a',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  // Show window immediately once ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // 2. Allocate dynamic free port
  const port = await getFreePort();
  process.env.PORT = port.toString();
  logger.log(`Allocated server port: ${port}`);

  // 3. Set up writable database and configuration paths
  try {
    initializeAssets(logger);
  } catch (e) {
    logger.logErr(e);
  }

  // 4. Start express server
  const serverPath = path.join(__dirname, 'dist', 'server.js');
  if (fs.existsSync(serverPath)) {
    try {
      logger.log('Launching bundled Express server...');
      require(serverPath);
      logger.log('Express server required successfully.');
    } catch (serverErr) {
      logger.logErr(serverErr);
    }
  }

  // 5. Load URL instantly
  const targetUrl = `http://localhost:${port}`;
  logger.log(`Loading URL: ${targetUrl}`);
  mainWindow.loadURL(targetUrl);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.on('ready', startServerAndWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
