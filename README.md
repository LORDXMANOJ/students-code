# Student Code Tracker (LeetCode & CodeChef Leaderboard)

A full-stack web application designed to track students' daily programming statistics and active streaks on **LeetCode** and **CodeChef**, showcasing them on a real-time global leaderboard.

---

## 🚀 How to Run the App Locally

Follow these step-by-step instructions to get the application running on your local machine.

### Prerequisites

Make sure you have the following installed on your system:
- **Node.js** (v18 or higher) - [Download here](https://nodejs.org/)
- **npm** (comes with Node.js)
- **Git** (for cloning the repository)

---## 📦 Project Structure

```
code tracker/
├── backend/          # Express.js backend server with SQLite database
│   ├── server.ts     # Main server file
│   └── package.json  # Backend dependencies
├── frontend/         # Angular frontend application
│   ├── src/          # Angular source code
│   └── package.json  # Frontend dependencies
└── README.md         # This file
```

---

## 🔧 Step 1: Set Up the Backend Server

Navigate to the `backend` directory in your terminal:

```bash
cd backend
```

### 1.1 Install Backend Dependencies

```bash
npm install
```

This will install all required packages including Express, SQLite adapter (`better-sqlite3`), and web scraping libraries.

### 1.2 Seed Initial Students and Statistics

Run the seeding script to automatically set up the SQLite database and fetch student statistics:

```bash
npx tsx seed.ts
```

This will:
- Automatically initialize the SQLite database file (`dev.db`) and create the required tables.
- Load student profiles from `students.json`.
- Fetch current LeetCode and CodeChef statistics for each student.
- Populate initial daily statistics.

**Note:** Use `npx tsx` not `npm tsx`

### 1.3 Start the Backend Server

```bash
npm run server
```

The backend server will start at **http://localhost:3000**

---

## 💻 Step 2: Set Up the Frontend Application

Open a **new terminal window/tab** and navigate to the `frontend` directory:

```bash
cd frontend
```

### 2.1 Install Frontend Dependencies

```bash
npm install
```

This installs Angular CLI, Angular framework, and all required dependencies.

### 2.2 Start the Angular Development Server

```bash
npm start
```

or

```bash
ng serve
```

The Angular development server will compile the application and start at **http://localhost:4200**

### 2.3 Access the Application

Once compiled, navigate to **http://localhost:4200** in your web browser to access the leaderboard dashboard.

---

## 🗄️ How the Local Database Works

### Database Technology

This application uses **SQLite** as its local database, managed directly through the `better-sqlite3` library. SQLite is a lightweight, file-based database that requires no separate database server - perfect for local development.

### Database File Location

The SQLite database is stored in:
```
backend/dev.db
```

This file is automatically created on startup and contains all your student data and statistics.

### Database Schema

The database consists of two main tables:

#### Students Table
- `id` - Unique identifier
- `name` - Student name
- `leetcodeHandle` - LeetCode username
- `codechefHandle` - CodeChef username (optional)

#### DailyStats Table
- `id` - Unique identifier
- `studentId` - Reference to student
- `date` - Date of the statistics
- `streak` - Current LeetCode streak
- `totalSolved` - Total LeetCode problems solved
- `easy`, `medium`, `hard` - Problems solved by difficulty
- `solvedToday` - Problems solved today
- `codechefSolved` - CodeChef total problems solved

### Data Persistence

- The database file (`dev.db`) persists all your data locally.
- You can backup the database by copying the `dev.db` file.
- To reset the database, simply delete `dev.db` and re-run the seed command.
- Student profiles are managed externally in `backend/students.json` for easy editing.

### Re-seeding the Database

If you need to refresh the data:

```bash
# Stop the backend server first (Ctrl+C)
cd backend
npx tsx seed.ts
npm run server
```

---

## ✨ Features

- **Global Leaderboard**: Displays rank, name, LeetCode streak, LeetCode easy/medium/hard solves, CodeChef total solves, and daily total solves
- **Editable Student Profiles**: Add, edit, or delete student profiles directly from the UI
- **Real-time Statistics**: Fetches live data from LeetCode and CodeChef APIs
- **Unique Constraints**: Prevents duplicate LeetCode/CodeChef accounts
- **Database Externalization**: Tracked students are managed in `backend/students.json`
- **Responsive Design**: Works on desktop and mobile devices

---

## 🛠️ Available Scripts

### Backend (from `/backend` directory)
- `npm run server` - Start the Express server on port 3000
- `npx tsx seed.ts` - Seed database with initial student data

### Frontend (from `/frontend` directory)
- `npm start` or `ng serve` - Start development server on port 4200
- `npm run build` - Build the application for production
- `npm run watch` - Build and watch for changes
- `npm test` - Run unit tests

---

## 🔍 Troubleshooting

### Node.js Version Mismatch Error

If you see an error about `better_sqlite3.node` being compiled against a different Node.js version:

```bash
cd backend
npm rebuild better-sqlite3
```

Or completely reinstall:
```bash
cd backend
Remove-Item -Recurse -Force node_modules
npm install
```

### Port Already in Use
If port 3000 or 4200 is already in use:
- Backend: Set `PORT` environment variable: `$env:PORT=3001; npm run server` (PowerShell) or `PORT=3001 npm run server` (Git Bash)
- Frontend: Run `ng serve --port 4201`

### Database Issues
If you encounter database errors:
1. Stop the backend server
2. Delete `backend/dev.db`
3. Run `npx tsx seed.ts`
4. Restart the server

### Dependencies Issues
If packages fail to install:
```bash
# Delete node_modules and reinstall
Remove-Item -Recurse -Force node_modules, package-lock.json
npm install
```

### Command Not Found
- Use `npx tsx` not `npm tsx`
- `npx` comes with npm and runs packages from node_modules/.bin

---

## 📝 Notes

- The application fetches real-time data from LeetCode and CodeChef, so internet connection is required
- LeetCode statistics update automatically based on the student's submission calendar
- CodeChef statistics are scraped from their public profile pages
- The database is SQLite-based and stored locally in the `backend/` directory
- All 23 students are configured in `backend/students.json` and can be edited

---

## 🤝 Contributing

Feel free to submit issues and enhancement requests!

---

## 📄 License

ISC License

---

**Built with ❤️ using Node.js, Express, SQLite, and Angular**
