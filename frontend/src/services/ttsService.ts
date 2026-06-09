type SpeakOptions = {
  urgent?: boolean;
};

class TtsService {
  private readonly lang = 'ru-RU';
  private readonly rate = 1.05;
  private readonly volume = 1;

  speak(text: string) {
    this.enqueue(text);
  }

  speakUrgent(text: string) {
    const synthesis = this.getSynthesis();
    if (!synthesis) return;

    synthesis.cancel();
    this.enqueue(text, { urgent: true });
  }

  private enqueue(text: string, options: SpeakOptions = {}) {
    const synthesis = this.getSynthesis();
    const normalizedText = text.trim();
    if (!synthesis || !normalizedText) return;

    const utterance = new SpeechSynthesisUtterance(normalizedText);
    utterance.lang = this.lang;
    utterance.rate = this.rate;
    utterance.volume = this.volume;

    if (options.urgent) {
      utterance.pitch = 1.05;
    }

    synthesis.speak(utterance);
  }

  private getSynthesis(): SpeechSynthesis | null {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      return null;
    }

    return window.speechSynthesis;
  }
}

export const tts = new TtsService();
export default tts;
