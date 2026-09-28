import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideNzI18n, en_US } from 'ng-zorro-antd/i18n';
import { provideNzIcons } from 'ng-zorro-antd/icon';
import { provideNzNativeDateAdapter } from 'ng-zorro-antd/core/time';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzModalService } from 'ng-zorro-antd/modal';
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
    }),
    // The modal and message services are injected by the workspace shell, both
    // record views, the activity composer, the loss-reason dialog and the
    // quick-create drawer. Registering them at the root injector makes the
    // dependency explicit here instead of relying on the library's own
    // tree-shakable scope, so a single missing provider is a compile-time
    // omission rather than an NG0201 white screen at first interaction.
    NzModalService,
    NzMessageService,
    // `NzDateAdapter` is not tree-shakable: it carries no `ɵprov` of its own and
    // exists only as the value produced by this provider. Without it every
    // `nz-date-picker` raises NG0201 the moment the Activity composer mounts,
    // which is inside both record views.
    provideNzNativeDateAdapter()
  ]
};
