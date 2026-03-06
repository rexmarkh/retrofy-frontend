import { Component, Input, Output, EventEmitter, OnInit } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';

@Component({
  selector: 'app-navigation',
  templateUrl: './navigation.component.html',
  styleUrls: ['./navigation.component.scss'],
  standalone: false
})
export class NavigationComponent implements OnInit {
  @Input() expanded: boolean;
  @Output() manualToggle = new EventEmitter();

  isRetrospectiveRoute = false;

  constructor(private router: Router) {
    this.router.events
      .pipe(filter((event) => event instanceof NavigationEnd))
      .subscribe((event: any) => {
        this.isRetrospectiveRoute = event.urlAfterRedirects.includes('/retrospective');
      });
  }

  ngOnInit() {
    this.isRetrospectiveRoute = this.router.url.includes('/retrospective');
  }

  toggle() {
    this.manualToggle.emit();
  }
}
