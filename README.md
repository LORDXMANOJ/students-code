# Student Code Tracker (LeetCode & CodeChef Leaderboard)

A full-stack web application designed to track students' daily programming statistics and active streaks on **LeetCode** and **CodeChef**, showcasing them on a real-time global leaderboard.

---

## 🚀 How to Run the App Locally

Follow these step-by-step instructions to get the application running on your local machine:

### Prerequisites
Make sure you have **Node.js** (v18 or higher) installed on your system.

---

### Step 1: Run the Backend Server

Navigate to the `backend` directory in your terminal:
```bash
cd backend
```

1. **Install Backend Dependencies:**
   ```bash
   npm install
   ```

2. **Setup the SQLite Database Schema:**
   Sync the database schema via Prisma:
   ```bash
   npx prisma db push
   ```

3. **Seed Initial Students and Statistics:**
   Run the seeding script to add the 23 student profiles and fetch their latest stats:
   ```bash
   npx tsx seed.ts
   ```

4. **Start the Backend Server:**
   ```bash
   npm run server
   ```
   The backend server will run at **[http://localhost:3000](http://localhost:3000)**.

---

### Step 2: Run the Frontend App

Open a new terminal window/tab and navigate to the `frontend` directory:
```bash
cd frontend
```

1. **Install Frontend Dependencies:**
   ```bash
   npm install
   ```

2. **Start the Angular Development Server:**
   ```bash
   npm start
   ```

3. **Access the Dashboard:**
   Once compiled, navigate to **[http://localhost:4200](http://localhost:4200)** in your web browser.

---

## 🛠️ Features

* **Global Leaderboard**: Displays rank, name, LeetCode streak, LeetCode easy/medium/hard solves, CodeChef total solves, and daily total solves.
* **Editable Student Profiles**: Add, edit, or delete student profiles directly from the UI.
* **Database Externalization**: Tracked students are managed inside the external configuration file `backend/students.json`.
* **Unique Constraints**: Handlers automatically prevent duplicate LeetCode/CodeChef accounts.
* **GraphQL Scrapers**: Fetches real-time profile stats directly from LeetCode and CodeChef APIs.
