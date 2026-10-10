import type { NavigatorScreenParams } from '@react-navigation/native';

export type OrdersStackParamList = {
  OrdersList: undefined;
  OrderDetail: { orderId: string };
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
  Admin: { section?: 'orders' | 'receipts'; orderId?: string } | undefined;
  Staff: undefined;
  PublicHome: undefined;
  QrMenu: { tableToken: string };
  Queue: { code?: string; cafe?: string } | undefined;
  Platform: undefined;
};
