import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';

@Component({
    selector: 'j-avatar',
    templateUrl: './avatar.component.html',
    styleUrls: ['./avatar.component.scss'],
    standalone: false
})
export class AvatarComponent implements OnChanges {
  @Input() avatarUrl: string;
  @Input() size = 32;
  @Input() name = '';
  @Input() rounded = true;
  @Input() className = '';

  initials: string = '';

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['name']) {
      this.calculateInitials();
    }
  }

  private calculateInitials() {
    if (!this.name) {
      this.initials = '';
      return;
    }

    // Split by space and get first chars, or just take first 2 chars if no space
    const parts = this.name.trim().split(/\s+/);
    if (parts.length > 1) {
      this.initials = (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
    } else {
      this.initials = this.name.slice(0, 2).toUpperCase();
    }
  }

  get containerStyle() {
    return {
      width: `${this.size}px`,
      height: `${this.size}px`,
      'border-radius': this.rounded ? '100%' : '4px',
      'font-size': `${this.size * 0.4}px`
    };
  }

  get imageStyle() {
    return {
      'background-image': `url('${this.avatarUrl}')`
    };
  }
}
