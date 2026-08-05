import { defineSecret, defineString } from 'firebase-functions/params'

export const participantSecretKey = defineSecret('PARTICIPANT_SECRET_KEY')
export const bootstrapOwnerEmail = defineString('BOOTSTRAP_OWNER_EMAIL', {
  default: 'jammanbogem@gmail.com',
  description: 'Verified Google account allowed to create the initial VIBE26 owner membership.',
})

export const EVENT_ID = 'room-vibe26'
export const PUBLIC_SLUG = 'vibecoding-2026'
export const REGION = 'asia-northeast3'
export const MAX_PARTICIPANTS = 100
