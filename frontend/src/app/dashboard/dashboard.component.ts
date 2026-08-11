import { Component, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

interface StudentData {
  id: number;
  name: string;
  leetcodeStreak: number;
  codechefRating: number;
  totalSolved: number;
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.css']
})
export class DashboardComponent {
  students = signal<StudentData[]>([]);

  searchQuery = signal('');
  lastUpdated = new Date();

  sortField = signal<keyof StudentData>('totalSolved');
  sortAscending = signal(false);

  filteredAndSortedStudents = computed(() => {
    let result = this.students();
    const query = this.searchQuery().toLowerCase();
    
    if (query) {
      result = result.filter(s => s.name.toLowerCase().includes(query));
    }

    const field = this.sortField();
    const asc = this.sortAscending();

    result = [...result].sort((a, b) => {
      const valA = a[field];
      const valB = b[field];
      if (typeof valA === 'string' && typeof valB === 'string') {
        return asc ? valA.localeCompare(valB) : valB.localeCompare(valA);
      }
      return asc ? (valA as number) - (valB as number) : (valB as number) - (valA as number);
    });

    return result.map((s, index) => ({ ...s, rank: index + 1 }));
  });

  top5Students = computed(() => {
    return [...this.students()].sort((a, b) => b.totalSolved - a.totalSolved).slice(0, 5);
  });

  metrics = computed(() => {
    const all = this.students();
    return {
      active: all.length,
      highestStreak: Math.max(...all.map(s => s.leetcodeStreak), 0),
      solvedThisWeek: 345 // Mocked data
    };
  });

  sortBy(field: keyof StudentData) {
    if (this.sortField() === field) {
      this.sortAscending.set(!this.sortAscending());
    } else {
      this.sortField.set(field);
      this.sortAscending.set(false);
    }
  }

  onSearch(event: Event) {
    const input = event.target as HTMLInputElement;
    this.searchQuery.set(input.value);
  }
}
