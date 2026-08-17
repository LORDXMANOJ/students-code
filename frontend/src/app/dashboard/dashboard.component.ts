import { Component, computed, signal, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import * as XLSX from 'xlsx';

export interface User {
  id: number;
  email: string;
  role: 'SUPER_ADMIN' | 'DEPARTMENT_USER';
  departmentId: number | null;
  departmentName?: string | null;
}

export interface Department {
  id: number;
  name: string;
  created_at: string;
  updated_at: string;
  studentCount?: number;
  sectionCount?: number;
  lastUpdated?: string | null;
}

export interface UserRow {
  id: number;
  email: string;
  role: 'SUPER_ADMIN' | 'DEPARTMENT_USER';
  department_id: number | null;
  departmentName?: string | null;
  created_at: string;
  updated_at: string;
}

export interface StudentData {
  id: number;
  name: string;
  leetcodeHandle?: string;
  codechefHandle?: string;
  year: number;
  section: string;
  department_id: number;
  leetcodeStreak: number;
  leetcodeEasy: number;
  leetcodeMedium: number;
  leetcodeHard: number;
  codechefSolved: number;
  totalSolved: number;
  solvedToday: number;
}

export interface BulkRow {
  name: string;
  leetcodeUrl: string;
  codechefUrl: string;
  year: string;
  section: string;
  isValid: boolean;
  isChecking: boolean;
  errors: string[];
}

export type ViewMode = 'login' | 'admin-departments' | 'admin-users' | 'academic-structure' | 'dashboard' | 'profile';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.css']
})
export class DashboardComponent implements OnInit, OnDestroy {
  // ─── Authentication & Current User ────────────────────────
  currentUser = signal<User | null>(null);
  token = signal<string | null>(null);

  // Login Form State
  loginEmail = '';
  loginPassword = '';
  showPassword = false;
  loginError = '';
  isLoggingIn = false;

  // View Navigation
  viewMode = signal<ViewMode>('login');
  isEnteringDashboard = signal<boolean>(false);

  // Active Department Context
  departments = signal<Department[]>([]);
  activeDepartmentId = signal<number | null>(null);
  activeDepartmentName = signal<string>('');

  // Department Management Modals (Admin)
  showAddDeptModal = signal(false);
  newDeptName = '';
  showRenameDeptModal = signal(false);
  editingDept = { id: 0, name: '' };

  // User Management State (Admin)
  usersList = signal<UserRow[]>([]);
  showAddUserModal = signal(false);
  newUser = {
    email: '',
    password: '',
    confirmPassword: '',
    departmentId: 0
  };
  showResetPasswordModal = signal(false);
  resettingUser = {
    id: 0,
    email: '',
    newPassword: '',
    confirmPassword: ''
  };

  // Profile / Password State
  passwordForm = {
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  };
  profileMessage = '';
  profileError = '';
  isChangingPassword = false;

  // ─── Academic Navigation & Dashboard State ────────────────
  students = signal<StudentData[]>([]);
  searchQuery = signal('');
  lastUpdated = new Date();

  expandedYear = signal<number | null>(null);
  selectedYear = signal<number | null>(null);
  selectedSection = signal<string | null>(null);

  // Add / Edit Student Form State
  showAddStudentForm = signal(false);
  addMode = signal<'single' | 'bulk'>('single');
  newStudent = {
    name: '',
    leetcodeLink: '',
    codechefLink: '',
    year: 2,
    section: 'A'
  };
  isAdding = signal(false);
  isRefreshing = signal(false);

  // Bulk Upload State
  bulkPreview = signal<BulkRow[]>([]);
  isImportingBulk = signal(false);
  bulkProgressText = signal<string | null>(null);
  private progressInterval: any;

  // Edit Student Form State
  showEditStudentForm = signal(false);
  editingStudentId = signal<number | null>(null);
  editingStudent = {
    name: '',
    leetcodeLink: '',
    codechefLink: '',
    year: 2,
    section: 'A'
  };
  isSaving = signal(false);

  // Sorting state
  sortColumn = signal<keyof StudentData>('totalSolved');
  sortAscending = signal(false);

  // Options
  yearKeys = [1, 2, 3, 4];
  yearLabels: Record<number, string> = { 1: 'First Year', 2: 'Second Year', 3: 'Third Year', 4: 'Fourth Year' };
  allowedYears = [
    { val: 1, label: 'I Year' },
    { val: 2, label: 'II Year' },
    { val: 3, label: 'III Year' },
    { val: 4, label: 'IV Year' }
  ];
  allowedSections = ['A', 'B', 'C', 'D'];

  getApiUrl(path: string): string {
    const isDev = window.location.port === '4200';
    return isDev ? `http://localhost:3000${path}` : path;
  }

  getAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const t = this.token();
    if (t) {
      headers['Authorization'] = `Bearer ${t}`;
    }
    return headers;
  }

  ngOnInit() {
    this.restoreSession();
  }

  ngOnDestroy() {
    if (this.progressInterval) {
      clearInterval(this.progressInterval);
    }
  }

  // ─── Session & Auth Methods ───────────────────────────────

  restoreSession() {
    const savedToken = sessionStorage.getItem('codetracker_token');
    const savedUserStr = sessionStorage.getItem('codetracker_user');

    if (savedToken && savedUserStr) {
      try {
        const user: User = JSON.parse(savedUserStr);
        this.token.set(savedToken);
        this.currentUser.set(user);
        this.onUserLoggedIn(user);
        return;
      } catch (e) {
        sessionStorage.removeItem('codetracker_token');
        sessionStorage.removeItem('codetracker_user');
      }
    }
    this.viewMode.set('login');
  }

  async login() {
    if (!this.loginEmail || !this.loginPassword) {
      this.loginError = 'Please enter both email and password.';
      return;
    }

    this.isLoggingIn = true;
    this.loginError = '';

    try {
      const res = await fetch(this.getApiUrl('/api/auth/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: this.loginEmail, password: this.loginPassword })
      });

      const data = await res.json();
      if (!res.ok) {
        this.loginError = data.error || 'Invalid credentials.';
        this.isLoggingIn = false;
        return;
      }

      this.token.set(data.token);
      this.currentUser.set(data.user);
      sessionStorage.setItem('codetracker_token', data.token);
      sessionStorage.setItem('codetracker_user', JSON.stringify(data.user));

      this.loginEmail = '';
      this.loginPassword = '';
      this.onUserLoggedIn(data.user);
    } catch (e) {
      this.loginError = 'Unable to connect to the authentication server.';
    } finally {
      this.isLoggingIn = false;
    }
  }

  onUserLoggedIn(user: User) {
    if (user.role === 'SUPER_ADMIN') {
      this.fetchDepartments();
      this.viewMode.set('admin-departments');
    } else {
      this.activeDepartmentId.set(user.departmentId);
      this.activeDepartmentName.set(user.departmentName || 'My Department');
      this.fetchLeaderboard();
      this.viewMode.set('academic-structure');
    }
  }

  logout() {
    sessionStorage.removeItem('codetracker_token');
    sessionStorage.removeItem('codetracker_user');
    this.token.set(null);
    this.currentUser.set(null);
    this.students.set([]);
    this.activeDepartmentId.set(null);
    this.activeDepartmentName.set('');
    this.selectedYear.set(null);
    this.selectedSection.set(null);
    this.viewMode.set('login');
  }

  // ─── Department Operations (Super Admin) ──────────────────

  async fetchDepartments() {
    try {
      const res = await fetch(this.getApiUrl('/api/departments'), {
        headers: this.getAuthHeaders()
      });
      if (res.ok) {
        const data = await res.json();
        this.departments.set(data);
        if (data.length > 0 && !this.newUser.departmentId) {
          this.newUser.departmentId = data[0].id;
        }
      }
    } catch (e) {
      console.error('Failed to fetch departments:', e);
    }
  }

  openDepartment(dept: Department) {
    this.activeDepartmentId.set(dept.id);
    this.activeDepartmentName.set(dept.name);
    this.fetchLeaderboard();
    this.viewMode.set('academic-structure');
  }

  openAddDepartmentModal() {
    this.newDeptName = '';
    this.showAddDeptModal.set(true);
  }

  async saveNewDepartment() {
    if (!this.newDeptName.trim()) return;
    try {
      const res = await fetch(this.getApiUrl('/api/departments'), {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify({ name: this.newDeptName.trim() })
      });
      const data = await res.json();
      if (res.ok) {
        this.showAddDeptModal.set(false);
        this.newDeptName = '';
        await this.fetchDepartments();
      } else {
        alert(data.error || 'Failed to create department.');
      }
    } catch (e) {
      alert('Error connecting to server.');
    }
  }

  openRenameDepartmentModal(dept: Department, event?: Event) {
    if (event) event.stopPropagation();
    this.editingDept = { id: dept.id, name: dept.name };
    this.showRenameDeptModal.set(true);
  }

  async saveRenamedDepartment() {
    if (!this.editingDept.name.trim() || !this.editingDept.id) return;
    try {
      const res = await fetch(this.getApiUrl(`/api/departments/${this.editingDept.id}`), {
        method: 'PUT',
        headers: this.getAuthHeaders(),
        body: JSON.stringify({ name: this.editingDept.name.trim() })
      });
      const data = await res.json();
      if (res.ok) {
        this.showRenameDeptModal.set(false);
        await this.fetchDepartments();
      } else {
        alert(data.error || 'Failed to rename department.');
      }
    } catch (e) {
      alert('Error connecting to server.');
    }
  }

  // ─── User Management (Super Admin) ────────────────────────

  async fetchUsers() {
    try {
      const res = await fetch(this.getApiUrl('/api/users'), {
        headers: this.getAuthHeaders()
      });
      if (res.ok) {
        const data = await res.json();
        this.usersList.set(data);
      }
    } catch (e) {
      console.error('Failed to fetch users:', e);
    }
  }

  openAddUserModal() {
    this.newUser = {
      email: '',
      password: '',
      confirmPassword: '',
      departmentId: this.departments().length > 0 ? this.departments()[0].id : 0
    };
    this.showAddUserModal.set(true);
  }

  async saveNewUser() {
    if (!this.newUser.email || !this.newUser.password || !this.newUser.departmentId) {
      alert('Please fill out all required fields.');
      return;
    }
    if (this.newUser.password !== this.newUser.confirmPassword) {
      alert('Passwords do not match.');
      return;
    }
    if (this.newUser.password.length < 6) {
      alert('Password must be at least 6 characters.');
      return;
    }

    try {
      const res = await fetch(this.getApiUrl('/api/users'), {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify({
          email: this.newUser.email,
          password: this.newUser.password,
          departmentId: this.newUser.departmentId
        })
      });
      const data = await res.json();
      if (res.ok) {
        this.showAddUserModal.set(false);
        await this.fetchUsers();
      } else {
        alert(data.error || 'Failed to create user.');
      }
    } catch (e) {
      alert('Error connecting to server.');
    }
  }

  openResetPasswordModal(user: UserRow) {
    this.resettingUser = {
      id: user.id,
      email: user.email,
      newPassword: '',
      confirmPassword: ''
    };
    this.showResetPasswordModal.set(true);
  }

  async submitResetPassword() {
    if (!this.resettingUser.newPassword) {
      alert('Please enter a new password.');
      return;
    }
    if (this.resettingUser.newPassword !== this.resettingUser.confirmPassword) {
      alert('Passwords do not match.');
      return;
    }
    if (this.resettingUser.newPassword.length < 6) {
      alert('Password must be at least 6 characters.');
      return;
    }

    try {
      const res = await fetch(this.getApiUrl(`/api/users/${this.resettingUser.id}/reset-password`), {
        method: 'PUT',
        headers: this.getAuthHeaders(),
        body: JSON.stringify({ newPassword: this.resettingUser.newPassword })
      });
      const data = await res.json();
      if (res.ok) {
        this.showResetPasswordModal.set(false);
        alert(data.message || 'Password reset successfully.');
      } else {
        alert(data.error || 'Failed to reset password.');
      }
    } catch (e) {
      alert('Error connecting to server.');
    }
  }

  async deleteUserAccount(user: UserRow) {
    if (!confirm(`Are you sure you want to delete user account "${user.email}"? This will only remove their login access.`)) return;
    try {
      const res = await fetch(this.getApiUrl(`/api/users/${user.id}`), {
        method: 'DELETE',
        headers: this.getAuthHeaders()
      });
      const data = await res.json();
      if (res.ok) {
        await this.fetchUsers();
      } else {
        alert(data.error || 'Failed to delete user.');
      }
    } catch (e) {
      alert('Error connecting to server.');
    }
  }

  // ─── Profile & Change Password ────────────────────────────

  async submitChangePassword() {
    if (!this.passwordForm.currentPassword || !this.passwordForm.newPassword) {
      this.profileError = 'Please fill out all fields.';
      return;
    }
    if (this.passwordForm.newPassword !== this.passwordForm.confirmPassword) {
      this.profileError = 'New passwords do not match.';
      return;
    }
    if (this.passwordForm.newPassword.length < 6) {
      this.profileError = 'Password must be at least 6 characters.';
      return;
    }

    this.isChangingPassword = true;
    this.profileError = '';
    this.profileMessage = '';

    try {
      const res = await fetch(this.getApiUrl('/api/auth/change-password'), {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify({
          currentPassword: this.passwordForm.currentPassword,
          newPassword: this.passwordForm.newPassword
        })
      });
      const data = await res.json();
      if (res.ok) {
        this.profileMessage = 'Password changed successfully.';
        this.passwordForm = { currentPassword: '', newPassword: '', confirmPassword: '' };
      } else {
        this.profileError = data.error || 'Failed to change password.';
      }
    } catch (e) {
      this.profileError = 'Error connecting to server.';
    } finally {
      this.isChangingPassword = false;
    }
  }

  // ─── Leaderboard & Academic Structure ─────────────────────

  async fetchLeaderboard() {
    const deptId = this.activeDepartmentId();
    if (!deptId) return;

    try {
      const url = this.currentUser()?.role === 'SUPER_ADMIN'
        ? `/api/leaderboard?departmentId=${deptId}`
        : '/api/leaderboard';

      const res = await fetch(this.getApiUrl(url), {
        headers: this.getAuthHeaders()
      });
      if (res.ok) {
        const data = await res.json();
        this.students.set(data);
        this.lastUpdated = new Date();
      }
    } catch (e) {
      console.error('Failed to fetch leaderboard', e);
    }
  }

  navStructure = computed(() => {
    const studs = this.students();
    const structure: Record<number, { count: number; sections: Record<string, number> }> = {
      1: { count: 0, sections: {} },
      2: { count: 0, sections: {} },
      3: { count: 0, sections: {} },
      4: { count: 0, sections: {} },
    };
    for (const s of studs) {
      if (s.year >= 1 && s.year <= 4) {
        structure[s.year].count++;
        if (!structure[s.year].sections[s.section]) {
          structure[s.year].sections[s.section] = 0;
        }
        structure[s.year].sections[s.section]++;
      }
    }
    return structure;
  });

  objectKeys(obj: any): string[] {
    return obj ? Object.keys(obj).sort() : [];
  }

  toggleYear(year: number) {
    if (this.expandedYear() === year) {
      this.expandedYear.set(null);
    } else {
      this.expandedYear.set(year);
    }
  }

  enterDashboard(year: number, section: string | null) {
    this.isEnteringDashboard.set(true);
    setTimeout(() => {
      this.selectedYear.set(year);
      this.selectedSection.set(section);
      this.viewMode.set('dashboard');
      this.isEnteringDashboard.set(false);

      // Auto pre-fill Add Student form
      this.newStudent.year = year;
      this.newStudent.section = section || 'A';
    }, 500);
  }

  goBackToAcademicStructure() {
    this.viewMode.set('academic-structure');
    this.selectedYear.set(null);
    this.selectedSection.set(null);
  }

  goBackToDepartments() {
    this.viewMode.set('admin-departments');
    this.activeDepartmentId.set(null);
    this.activeDepartmentName.set('');
    this.fetchDepartments();
  }

  // ─── Filter & Sort ────────────────────────────────────────

  filteredAndSortedStudents = computed(() => {
    let result = this.students();

    const y = this.selectedYear();
    const s = this.selectedSection();
    if (y !== null) {
      result = result.filter(st => st.year === y);
    }
    if (s !== null) {
      result = result.filter(st => st.section === s);
    }

    const query = this.searchQuery().toLowerCase();
    if (query) {
      result = result.filter(st => st.name.toLowerCase().includes(query));
    }

    const col = this.sortColumn();
    const asc = this.sortAscending();

    return result.sort((a, b) => {
      const valA = a[col];
      const valB = b[col];

      if (valA === undefined && valB !== undefined) return asc ? -1 : 1;
      if (valA !== undefined && valB === undefined) return asc ? 1 : -1;
      if (valA === undefined && valB === undefined) return 0;

      if (typeof valA === 'string' && typeof valB === 'string') {
        return asc ? valA.localeCompare(valB) : valB.localeCompare(valA);
      }

      return asc ? (valA as number) - (valB as number) : (valB as number) - (valA as number);
    });
  });

  totalActive = computed(() => this.filteredAndSortedStudents().length);
  highestStreak = computed(() => Math.max(...this.filteredAndSortedStudents().map(s => s.leetcodeStreak), 0));
  totalSolvedCombined = computed(() => this.filteredAndSortedStudents().reduce((sum, s) => sum + s.totalSolved, 0));

  setSort(column: keyof StudentData) {
    if (this.sortColumn() === column) {
      this.sortAscending.set(!this.sortAscending());
    } else {
      this.sortColumn.set(column);
      this.sortAscending.set(false);
    }
  }

  // ─── Section-Scoped Refresh ───────────────────────────────

  async refreshStats() {
    this.isRefreshing.set(true);
    try {
      const payload: any = {
        year: this.selectedYear(),
        section: this.selectedSection(),
        departmentId: this.activeDepartmentId()
      };

      const res = await fetch(this.getApiUrl('/api/leaderboard/refresh'), {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        const data = await res.json();
        this.students.set(data);
        this.lastUpdated = new Date();
      } else {
        alert('Failed to refresh leaderboard statistics.');
      }
    } catch (e) {
      console.error(e);
      alert('Error connecting to backend.');
    }
    this.isRefreshing.set(false);
  }

  // ─── Student CRUD ─────────────────────────────────────────

  async addStudent() {
    if (!this.newStudent.name || !this.newStudent.leetcodeLink) return;
    this.isAdding.set(true);
    try {
      const payload: any = {
        ...this.newStudent,
        departmentId: this.activeDepartmentId()
      };

      const res = await fetch(this.getApiUrl('/api/students'), {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (res.ok) {
        this.showAddStudentForm.set(false);
        this.newStudent = {
          name: '',
          leetcodeLink: '',
          codechefLink: '',
          year: this.selectedYear() || 2,
          section: this.selectedSection() || 'A'
        };
        await this.fetchLeaderboard();
      } else {
        alert(data.error || 'Failed to add student. Check links and uniqueness.');
      }
    } catch (e) {
      console.error(e);
      alert('Error connecting to backend.');
    }
    this.isAdding.set(false);
  }

  toggleAddForm() {
    this.showAddStudentForm.set(!this.showAddStudentForm());
    if (this.showAddStudentForm()) {
      this.showEditStudentForm.set(false);
      this.newStudent.year = this.selectedYear() || 2;
      this.newStudent.section = this.selectedSection() || 'A';
    }
  }

  openEditForm(student: StudentData) {
    this.editingStudentId.set(student.id);
    this.editingStudent = {
      name: student.name,
      leetcodeLink: student.leetcodeHandle ? `https://leetcode.com/${student.leetcodeHandle}` : '',
      codechefLink: student.codechefHandle ? `https://www.codechef.com/users/${student.codechefHandle}` : '',
      year: student.year,
      section: student.section
    };
    this.showEditStudentForm.set(true);
    this.showAddStudentForm.set(false);
  }

  closeEditForm() {
    this.showEditStudentForm.set(false);
    this.editingStudentId.set(null);
  }

  async updateStudent() {
    const id = this.editingStudentId();
    if (!id || !this.editingStudent.name || !this.editingStudent.leetcodeLink) return;
    this.isSaving.set(true);
    try {
      const res = await fetch(this.getApiUrl(`/api/students/${id}`), {
        method: 'PUT',
        headers: this.getAuthHeaders(),
        body: JSON.stringify(this.editingStudent)
      });
      if (res.ok) {
        this.closeEditForm();
        await this.fetchLeaderboard();
      } else {
        const data = await res.json();
        alert(data.error || 'Failed to update student.');
      }
    } catch (e) {
      console.error(e);
      alert('Error connecting to backend.');
    }
    this.isSaving.set(false);
  }

  async deleteStudent(id: number) {
    if (!confirm('Are you sure you want to remove this student?')) return;
    try {
      const res = await fetch(this.getApiUrl(`/api/students/${id}`), {
        method: 'DELETE',
        headers: this.getAuthHeaders()
      });
      if (res.ok) {
        await this.fetchLeaderboard();
      } else {
        alert('Failed to remove student.');
      }
    } catch (e) {
      console.error(e);
      alert('Error connecting to backend.');
    }
  }

  // ─── Bulk Upload Flow ─────────────────────────────────────

  downloadTemplate() {
    const ws = XLSX.utils.json_to_sheet([{
      'Name': 'John Doe',
      'LeetCode URL': 'https://leetcode.com/u/example',
      'CodeChef URL': 'https://www.codechef.com/users/example',
      'Year': 2,
      'Section': 'A'
    }]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Template');
    XLSX.writeFile(wb, 'Student_Upload_Template.xlsx');
  }

  async handleFileUpload(event: any) {
    const target = event.target as HTMLInputElement;
    if (!target.files?.length) return;
    const file = target.files[0];
    const reader = new FileReader();

    reader.onload = async (e: any) => {
      const bstr = e.target.result;
      const wb = XLSX.read(bstr, { type: 'binary' });
      const wsname = wb.SheetNames[0];
      const ws = wb.Sheets[wsname];
      const data = XLSX.utils.sheet_to_json(ws);

      const parsedRows: BulkRow[] = data.map((row: any) => ({
        name: row['Name']?.toString().trim() || '',
        leetcodeUrl: row['LeetCode URL']?.toString().trim() || '',
        codechefUrl: row['CodeChef URL']?.toString().trim() || '',
        year: row['Year']?.toString().trim() || '',
        section: row['Section']?.toString().trim() || '',
        isValid: false,
        isChecking: true,
        errors: []
      }));

      this.bulkPreview.set(parsedRows);

      for (const row of parsedRows) {
        await this.validateRow(row, parsedRows);
      }
      this.bulkPreview.set([...parsedRows]);
    };
    reader.readAsBinaryString(file);
    target.value = '';
  }

  async validateRow(row: BulkRow, allRows: BulkRow[]) {
    row.isChecking = true;
    row.isValid = false;
    row.errors = [];

    if (!row.name) row.errors.push('Name is required');

    // Strict Year validation
    const pYear = parseInt(row.year);
    if (isNaN(pYear) || pYear < 1 || pYear > 4) {
      row.errors.push('Year must be a number between 1 and 4.');
    } else {
      row.year = pYear.toString();
    }

    // Strict Section validation
    const sSection = row.section ? row.section.toString().trim().toUpperCase() : '';
    if (!['A', 'B', 'C', 'D'].includes(sSection)) {
      row.errors.push('Section must be A, B, C or D.');
    } else {
      row.section = sSection;
    }

    if (!row.leetcodeUrl) row.errors.push('LeetCode URL is required');
    if (!row.codechefUrl) row.errors.push('CodeChef URL is required');

    // Extract handles
    const lcHandle = row.leetcodeUrl.split('/').filter(Boolean).pop()?.split('?')[0];
    const ccHandle = row.codechefUrl.split('/').filter(Boolean).pop()?.split('?')[0];

    // Uniqueness inside excel
    if (lcHandle) {
      const matches = allRows.filter(r => r.leetcodeUrl.includes(lcHandle));
      if (matches.length > 1) row.errors.push('LeetCode URL is duplicated in Excel');
    }
    if (ccHandle) {
      const matches = allRows.filter(r => r.codechefUrl.includes(ccHandle));
      if (matches.length > 1) row.errors.push('CodeChef URL is duplicated in Excel');
    }

    // Network check
    if (lcHandle && row.errors.length === 0) {
      try {
        const res = await fetch(this.getApiUrl('/api/validate-url'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: row.leetcodeUrl, platform: 'leetcode' })
        });
        const data = await res.json();
        if (!data.valid) row.errors.push('LeetCode profile not found');
      } catch (e) {
        row.errors.push('Could not verify LeetCode profile');
      }
    }

    if (ccHandle && row.errors.length === 0) {
      try {
        const res = await fetch(this.getApiUrl('/api/validate-url'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: row.codechefUrl, platform: 'codechef' })
        });
        const data = await res.json();
        if (!data.valid) row.errors.push('CodeChef profile not found');
      } catch (e) {
        row.errors.push('Could not verify CodeChef profile');
      }
    }

    if (row.errors.length === 0) {
      row.isValid = true;
    }
    row.isChecking = false;
  }

  async recheckRow(row: BulkRow) {
    await this.validateRow(row, this.bulkPreview());
    this.bulkPreview.set([...this.bulkPreview()]);
  }

  removeRow(row: BulkRow) {
    this.bulkPreview.set(this.bulkPreview().filter(r => r !== row));
  }

  bulkReadyCount = computed(() => this.bulkPreview().filter(r => r.isValid).length);
  bulkFixCount = computed(() => this.bulkPreview().filter(r => !r.isValid).length);

  async importBulk() {
    const validRows = this.bulkPreview().filter(r => r.isValid);
    if (validRows.length === 0) return;

    this.isImportingBulk.set(true);

    const payload = validRows.map(r => ({
      name: r.name,
      leetcodeLink: r.leetcodeUrl,
      codechefLink: r.codechefUrl,
      year: parseInt(r.year),
      section: r.section
    }));

    try {
      const res = await fetch(this.getApiUrl('/api/students/bulk'), {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify({
          students: payload,
          departmentId: this.activeDepartmentId()
        })
      });

      if (res.status === 429) {
        alert('A bulk import is already in progress. Please wait.');
        this.isImportingBulk.set(false);
        return;
      }

      if (res.ok) {
        this.bulkPreview.set(this.bulkPreview().filter(r => !r.isValid));
        await this.fetchLeaderboard();
        this.startPollingProgress();
      } else {
        alert('Failed to start bulk import.');
      }
    } catch (e) {
      alert('Network error during bulk import.');
    }

    this.isImportingBulk.set(false);
  }

  startPollingProgress() {
    if (this.progressInterval) clearInterval(this.progressInterval);

    this.progressInterval = setInterval(async () => {
      try {
        const res = await fetch(this.getApiUrl('/api/stats/progress'), {
          headers: this.getAuthHeaders()
        });
        if (res.ok) {
          const data = await res.json();
          if (data.isProcessing) {
            this.bulkProgressText.set(`Updating coding statistics... ${data.completed} / ${data.total} completed`);
          } else {
            this.bulkProgressText.set(null);
            clearInterval(this.progressInterval);
            await this.fetchLeaderboard();
          }
        }
      } catch (e) {
        // keep polling
      }
    }, 2000);
  }
}
