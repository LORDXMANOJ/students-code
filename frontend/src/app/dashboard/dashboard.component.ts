import { Component, computed, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

interface StudentData {
  id: number;
  name: string;
  leetcodeHandle?: string;
  codechefHandle?: string;
  leetcodeStreak: number;
  leetcodeEasy: number;
  leetcodeMedium: number;
  leetcodeHard: number;
  codechefSolved: number;
  totalSolved: number;
  solvedToday: number;
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.css']
})
export class DashboardComponent implements OnInit {
  students = signal<StudentData[]>([]);
  searchQuery = signal('');
  lastUpdated = new Date();

  // Add Student Form State
  showAddStudentForm = signal(false);
  newStudent = {
    name: '',
    leetcodeLink: '',
    codechefLink: ''
  };
  isAdding = signal(false);

  // Edit Student Form State
  showEditStudentForm = signal(false);
  editingStudentId = signal<number | null>(null);
  editingStudent = {
    name: '',
    leetcodeLink: '',
    codechefLink: ''
  };
  isSaving = signal(false);

  // Sorting state
  sortColumn = signal<keyof StudentData>('totalSolved');
  sortAscending = signal(false);

  getApiUrl(path: string): string {
    const isDev = window.location.port === '4200';
    return isDev ? `http://localhost:3000${path}` : path;
  }

  ngOnInit() {
    this.fetchLeaderboard();
  }

  async fetchLeaderboard() {
    try {
      const res = await fetch(this.getApiUrl('/api/leaderboard'));
      const data = await res.json();
      this.students.set(data);
      this.lastUpdated = new Date();
    } catch (e) {
      console.error('Failed to fetch leaderboard', e);
    }
  }

  async addStudent() {
    if (!this.newStudent.name || !this.newStudent.leetcodeLink) return;
    this.isAdding.set(true);
    try {
      const res = await fetch(this.getApiUrl('/api/students'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this.newStudent)
      });
      if (res.ok) {
        this.showAddStudentForm.set(false);
        this.newStudent = { name: '', leetcodeLink: '', codechefLink: '' };
        await this.fetchLeaderboard(); // Refresh list
      } else {
        alert('Failed to add student. Check links and uniqueness.');
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
    }
  }

  openEditForm(student: StudentData) {
    this.editingStudentId.set(student.id);
    this.editingStudent = {
      name: student.name,
      leetcodeLink: student.leetcodeHandle ? `https://leetcode.com/${student.leetcodeHandle}` : '',
      codechefLink: student.codechefHandle ? `https://www.codechef.com/users/${student.codechefHandle}` : ''
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this.editingStudent)
      });
      if (res.ok) {
        this.closeEditForm();
        await this.fetchLeaderboard(); // Refresh list
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
        method: 'DELETE'
      });
      if (res.ok) {
        await this.fetchLeaderboard(); // Refresh list
      } else {
        alert('Failed to remove student.');
      }
    } catch (e) {
      console.error(e);
      alert('Error connecting to backend.');
    }
  }

  setSort(column: keyof StudentData) {
    if (this.sortColumn() === column) {
      this.sortAscending.set(!this.sortAscending());
    } else {
      this.sortColumn.set(column);
      this.sortAscending.set(false); // Default to desc when new column selected
    }
  }

  filteredAndSortedStudents = computed(() => {
    let result = this.students();
    const query = this.searchQuery().toLowerCase();
    
    if (query) {
      result = result.filter(s => s.name.toLowerCase().includes(query));
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

  // Calculate top-level stats
  totalActive = computed(() => this.students().length);
  highestStreak = computed(() => Math.max(...this.students().map(s => s.leetcodeStreak), 0));
  totalSolvedCombined = computed(() => this.students().reduce((sum, s) => sum + s.totalSolved, 0));
}
