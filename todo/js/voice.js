// Speech capture. Typing is the friction this app exists to remove, so the mic
// is a first-class way in, not a novelty: one tap, talk, and it keeps listening
// so you can reel off several things without touching the phone again.

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

export const isSupported = Boolean(SpeechRecognition);

/**
 * @param {object} handlers
 * @param {(text: string) => void}    handlers.onResult   a finished utterance
 * @param {(text: string) => void}    handlers.onInterim  live partial text
 * @param {() => void}                handlers.onStart
 * @param {() => void}                handlers.onStop
 * @param {(reason: string) => void}  handlers.onError    human-readable reason
 */
export function createVoiceCapture({ onResult, onInterim, onStart, onStop, onError }) {
  if (!isSupported) return null;

  let recognition = null;
  let listening = false;
  // Distinguishes "the engine stopped on its own" from "the user tapped stop".
  let stopRequested = false;
  let heardAnything = false;

  function build() {
    const rec = new SpeechRecognition();
    rec.lang = navigator.language || 'en-GB';
    rec.continuous = true;
    rec.interimResults = true;
    // One alternative is plenty; we're not offering a choice.
    rec.maxAlternatives = 1;

    rec.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0].transcript.trim();
        if (!text) continue;
        if (result.isFinal) {
          heardAnything = true;
          onResult(text);
        } else {
          interim += text + ' ';
        }
      }
      // Only when there's something partial to show — otherwise the empty
      // interim that follows a finished utterance would wipe out the
      // confirmation we just displayed for it.
      if (interim) onInterim(interim.trim());
    };

    rec.onerror = (event) => {
      switch (event.error) {
        case 'not-allowed':
        case 'service-not-allowed':
          stopRequested = true;
          onError('Microphone access was blocked. Allow it in Settings → Safari.');
          break;
        case 'no-speech':
          // Common and harmless: iOS gives up after a few seconds of silence.
          // onend restarts us, so say nothing.
          break;
        case 'audio-capture':
          stopRequested = true;
          onError('No microphone available.');
          break;
        case 'aborted':
          break;
        case 'network':
          stopRequested = true;
          onError('Speech recognition needs a connection on this device.');
          break;
        default:
          onError('Voice input stopped unexpectedly.');
      }
    };

    rec.onend = () => {
      // iOS Safari ends the session on its own every few seconds, and ignores
      // `continuous`. Restarting keeps a single tap feeling like one long
      // listen instead of a stream of dropouts.
      if (listening && !stopRequested) {
        try {
          rec.start();
          return;
        } catch {
          // start() throws if it's still winding down; fall through to stopping.
        }
      }
      listening = false;
      onStop();
    };

    return rec;
  }

  return {
    get listening() {
      return listening;
    },

    start() {
      if (listening) return;
      stopRequested = false;
      heardAnything = false;
      recognition = build();
      try {
        recognition.start();
        listening = true;
        onStart();
      } catch (err) {
        listening = false;
        onError('Could not start listening.');
      }
    },

    stop() {
      if (!listening) return;
      stopRequested = true;
      listening = false;
      try {
        recognition.stop();
      } catch {
        // Already stopped; onend still fires and tidies up.
      }
      onStop();
    },

    toggle() {
      if (listening) this.stop();
      else this.start();
    },

    get heardAnything() {
      return heardAnything;
    },
  };
}
