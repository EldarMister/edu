-- Existing React Native devices remain on Expo Push by default.
CREATE TYPE "PushProvider" AS ENUM ('EXPO', 'FCM');

ALTER TABLE "user_devices"
ADD COLUMN "push_provider" "PushProvider" NOT NULL DEFAULT 'EXPO';

CREATE INDEX "user_devices_push_provider_is_active_idx"
ON "user_devices"("push_provider", "is_active");
