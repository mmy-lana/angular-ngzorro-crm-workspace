import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideNzI18n, en_US } from 'ng-zorro-antd/i18n';
import { provideNzIcons } from 'ng-zorro-antd/icon';
import { provideNzConfig } from 'ng-zorro-antd/core/config';
import { IconDefinition } from '@ant-design/icons-angular';
import {
  DashboardOutline,
  TeamOutline,
  DollarOutline,
  CalendarOutline,
  FileTextOutline,
  PlusOutline,
  SearchOutline,
  CloseOutline,
  FilterOutline,
  CheckCircleOutline,
  ClockCircleOutline,
  RightOutline,
  MenuOutline,
  EditOutline,
  DeleteOutline,
  DownOutline
} from '@ant-design/icons-angular/icons';

export const APP_ICONS: IconDefinition[] = [
  DashboardOutline, TeamOutline, DollarOutline, CalendarOutline,
  FileTextOutline, PlusOutline, SearchOutline, CloseOutline,
  FilterOutline, CheckCircleOutline, ClockCircleOutline, RightOutline,
  MenuOutline, EditOutline, DeleteOutline, DownOutline
];

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter([], withComponentInputBinding()),
    provideAnimationsAsync(),
    provideNzI18n(en_US),
    provideNzIcons(APP_ICONS),
    provideNzConfig({
      theme: {
        primaryColor: '#0176d3'
      }
    })
  ]
};
