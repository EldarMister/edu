export type TelegramMessage = {
  message_id: number;
  text?: string;
  chat: {
    id: number;
    type: string;
    username?: string;
    first_name?: string;
    last_name?: string;
  };
  from?: {
    id: number;
    username?: string;
    first_name?: string;
    last_name?: string;
  };
};

export type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
};
