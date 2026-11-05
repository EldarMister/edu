// PWA main prerecorded samples, bundled for offline voice previews.
const samples: Record<string, Record<string, number>> = {
  baya: {
    s1: require('../../assets/kitchen-voice/baya/s1.mp3'),
    s2: require('../../assets/kitchen-voice/baya/s2.mp3'),
    s3: require('../../assets/kitchen-voice/baya/s3.mp3'),
    s4: require('../../assets/kitchen-voice/baya/s4.mp3'),
    s5: require('../../assets/kitchen-voice/baya/s5.mp3'),
    s6: require('../../assets/kitchen-voice/baya/s6.mp3'),
    s7: require('../../assets/kitchen-voice/baya/s7.mp3'),
    s8: require('../../assets/kitchen-voice/baya/s8.mp3'),
  },
  kseniya: {
    s1: require('../../assets/kitchen-voice/kseniya/s1.mp3'),
    s2: require('../../assets/kitchen-voice/kseniya/s2.mp3'),
    s3: require('../../assets/kitchen-voice/kseniya/s3.mp3'),
    s4: require('../../assets/kitchen-voice/kseniya/s4.mp3'),
    s5: require('../../assets/kitchen-voice/kseniya/s5.mp3'),
    s6: require('../../assets/kitchen-voice/kseniya/s6.mp3'),
    s7: require('../../assets/kitchen-voice/kseniya/s7.mp3'),
    s8: require('../../assets/kitchen-voice/kseniya/s8.mp3'),
  },
  xenia: {
    s1: require('../../assets/kitchen-voice/xenia/s1.mp3'),
    s2: require('../../assets/kitchen-voice/xenia/s2.mp3'),
    s3: require('../../assets/kitchen-voice/xenia/s3.mp3'),
    s4: require('../../assets/kitchen-voice/xenia/s4.mp3'),
    s5: require('../../assets/kitchen-voice/xenia/s5.mp3'),
    s6: require('../../assets/kitchen-voice/xenia/s6.mp3'),
    s7: require('../../assets/kitchen-voice/xenia/s7.mp3'),
    s8: require('../../assets/kitchen-voice/xenia/s8.mp3'),
  },
  eugene: {
    s1: require('../../assets/kitchen-voice/eugene/s1.mp3'),
    s2: require('../../assets/kitchen-voice/eugene/s2.mp3'),
    s3: require('../../assets/kitchen-voice/eugene/s3.mp3'),
    s4: require('../../assets/kitchen-voice/eugene/s4.mp3'),
    s5: require('../../assets/kitchen-voice/eugene/s5.mp3'),
    s6: require('../../assets/kitchen-voice/eugene/s6.mp3'),
    s7: require('../../assets/kitchen-voice/eugene/s7.mp3'),
    s8: require('../../assets/kitchen-voice/eugene/s8.mp3'),
  },
  aidar: {
    s1: require('../../assets/kitchen-voice/aidar/s1.mp3'),
    s2: require('../../assets/kitchen-voice/aidar/s2.mp3'),
    s3: require('../../assets/kitchen-voice/aidar/s3.mp3'),
    s4: require('../../assets/kitchen-voice/aidar/s4.mp3'),
    s5: require('../../assets/kitchen-voice/aidar/s5.mp3'),
    s6: require('../../assets/kitchen-voice/aidar/s6.mp3'),
    s7: require('../../assets/kitchen-voice/aidar/s7.mp3'),
    s8: require('../../assets/kitchen-voice/aidar/s8.mp3'),
  },
};

export function kitchenVoiceSample(speaker: string, scenario: string): number | undefined {
  return samples[speaker]?.[scenario];
}
