export interface A2APushNotificationAuthentication {
  readonly scheme: string;
  readonly credentials: string;
}

export interface A2APushNotificationConfig {
  readonly id: string;
  readonly ownerId: string;
  readonly taskId: string;
  readonly url: string;
  readonly token?: string;
  readonly authentication?: A2APushNotificationAuthentication;
}
