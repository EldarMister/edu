import type { NavigatorScreenParams } from '@react-navigation/native';
import type { AdminSection, FinanceView, RequestView, SettingsView, StaffView, MenuView, StatisticsView, WarehouseView } from './adminWorkspaceNavigation';

export type OrdersStackParamList = {
  OrdersList: undefined;
  OrderDetail: { orderId: string; fromSplitFamily?: boolean };
};
export type WaiterTabParamList = {
  Tables: undefined;
  Menu: undefined;
  Orders: NavigatorScreenParams<OrdersStackParamList> | undefined;
  Profile: undefined;
};

export type KitchenTabParamList = {
  Board: undefined;
  Profile: undefined;
};

export type RootStackParamList = {
  Login: undefined;
  Waiter: NavigatorScreenParams<WaiterTabParamList> | undefined;
  Kitchen: NavigatorScreenParams<KitchenTabParamList> | undefined;
  Bar: NavigatorScreenParams<KitchenTabParamList> | undefined;
  Admin: { section?: AdminSection; view?: MenuView | StatisticsView | WarehouseView | FinanceView | RequestView | SettingsView | StaffView | 'waiter-report'; orderId?: string } | undefined;
  Staff: undefined;
  PublicHome: undefined;
  QrMenu: { tableToken: string };
  Queue: { code?: string; cafe?: string } | undefined;
  Platform: undefined;
};
