/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
/* tslint:disable */

// @ts-ignore
import {GoogleGenAI} from '@google/genai';
// @ts-ignore
import {marked} from 'marked';

const MODEL_NAME = 'gemini-2.0-flash-lite';

interface Note {
  id: string;
  rawTranscription: string;
  polishedNote: string;
  timestamp: number;
}

class VoiceNotesApp {
  private genAI: any;
  private mediaRecorder: MediaRecorder | null = null;
  private recordButton: HTMLButtonElement;
  private recordingStatus: HTMLDivElement;
  private rawTranscription: HTMLDivElement;
  private polishedNote: HTMLDivElement;
  private newButton: HTMLButtonElement;
  private themeToggleButton: HTMLButtonElement;
  private themeToggleIcon: HTMLElement;
  private audioChunks: Blob[] = [];
  private isRecording = false;
  private isProcessing = false;
  private currentNote: Note | null = null;
  private stream: MediaStream | null = null;
  private editorTitle: HTMLDivElement;
  private hasAttemptedPermission = false;

  private recordingInterface: HTMLDivElement;
  private liveRecordingTitle: HTMLDivElement;
  private liveWaveformCanvas: HTMLCanvasElement | null;
  private liveWaveformCtx: CanvasRenderingContext2D | null = null;
  private liveRecordingTimerDisplay: HTMLDivElement;
  private statusIndicatorDiv: HTMLDivElement | null;

  private audioContext: AudioContext | null = null;
  private analyserNode: AnalyserNode | null = null;
  private waveformDataArray: Uint8Array | null = null;
  private waveformDrawingId: number | null = null;
  private timerIntervalId: number | null = null;
  private recordingStartTime: number = 0;
  
  // New properties for file upload
  private uploadButton: HTMLButtonElement;
  private audioFileInput: HTMLInputElement;
  
  // API Key related properties
  private settingsButton: HTMLButtonElement;
  private apiKeyModal: HTMLDivElement;
  private closeModalButton: HTMLElement;
  private apiKeyInput: HTMLInputElement;
  private saveApiKeyButton: HTMLButtonElement;
  private clearApiKeyButton: HTMLButtonElement;
  private apiKeyStatus: HTMLElement;

  constructor() {
    // Check for API key in localStorage
    const storedApiKey = localStorage.getItem('gemini_api_key');
    
    // Only initialize the API client if we have a key
    if (storedApiKey) {
      this.genAI = new GoogleGenAI({
        apiKey: storedApiKey,
      });
    } else {
      // Without an API key, we'll initialize with a placeholder that will prompt for a key
      this.genAI = null;
    }

    this.recordButton = document.getElementById(
      'recordButton',
    ) as HTMLButtonElement;
    this.recordingStatus = document.getElementById(
      'recordingStatus',
    ) as HTMLDivElement;
    this.rawTranscription = document.getElementById(
      'rawTranscription',
    ) as HTMLDivElement;
    this.polishedNote = document.getElementById(
      'polishedNote',
    ) as HTMLDivElement;
    this.newButton = document.getElementById('newButton') as HTMLButtonElement;
    this.themeToggleButton = document.getElementById(
      'themeToggleButton',
    ) as HTMLButtonElement;
    this.themeToggleIcon = this.themeToggleButton.querySelector(
      'i',
    ) as HTMLElement;
    this.editorTitle = document.querySelector(
      '.editor-title',
    ) as HTMLDivElement;

    this.recordingInterface = document.querySelector(
      '.recording-interface',
    ) as HTMLDivElement;
    this.liveRecordingTitle = document.getElementById(
      'liveRecordingTitle',
    ) as HTMLDivElement;
    this.liveWaveformCanvas = document.getElementById(
      'liveWaveformCanvas',
    ) as HTMLCanvasElement;
    this.liveRecordingTimerDisplay = document.getElementById(
      'liveRecordingTimerDisplay',
    ) as HTMLDivElement;
    
    // Initialize upload controls
    this.uploadButton = document.getElementById(
      'uploadButton'
    ) as HTMLButtonElement;
    this.audioFileInput = document.getElementById(
      'audioFileInput'
    ) as HTMLInputElement;
    
    // Initialize API key modal elements
    this.settingsButton = document.getElementById(
      'settingsButton'
    ) as HTMLButtonElement;
    this.apiKeyModal = document.getElementById(
      'apiKeyModal'
    ) as HTMLDivElement;
    this.closeModalButton = document.querySelector(
      '.close-modal'
    ) as HTMLElement;
    this.apiKeyInput = document.getElementById(
      'apiKeyInput'
    ) as HTMLInputElement;
    this.saveApiKeyButton = document.getElementById(
      'saveApiKeyButton'
    ) as HTMLButtonElement;
    this.clearApiKeyButton = document.getElementById(
      'clearApiKeyButton'
    ) as HTMLButtonElement;
    this.apiKeyStatus = document.getElementById(
      'apiKeyStatus'
    ) as HTMLElement;

    if (this.liveWaveformCanvas) {
      this.liveWaveformCtx = this.liveWaveformCanvas.getContext('2d');
    } else {
      console.warn(
        'Live waveform canvas element not found. Visualizer will not work.',
      );
    }

    if (this.recordingInterface) {
      this.statusIndicatorDiv = this.recordingInterface.querySelector(
        '.status-indicator',
      ) as HTMLDivElement;
    } else {
      console.warn('Recording interface element not found.');
      this.statusIndicatorDiv = null;
    }

    this.bindEventListeners();
    this.initTheme();
    this.createNewNote();

    this.recordingStatus.textContent = 'Ready to record';
  }

  private bindEventListeners(): void {
    this.recordButton.addEventListener('click', () => this.checkApiKeyThen(this.toggleRecording.bind(this)));
    this.newButton.addEventListener('click', () => this.createNewNote());
    this.themeToggleButton.addEventListener('click', () => this.toggleTheme());
    window.addEventListener('resize', this.handleResize.bind(this));
    
    // Add event listeners for file upload
    this.uploadButton.addEventListener('click', () => this.checkApiKeyThen(() => this.audioFileInput.click()));
    this.audioFileInput.addEventListener('change', (event) => this.handleFileUpload(event));
    
    // Add event listeners for API key modal
    this.settingsButton.addEventListener('click', () => this.openApiKeyModal());
    this.closeModalButton.addEventListener('click', () => this.closeApiKeyModal());
    this.saveApiKeyButton.addEventListener('click', () => this.saveApiKey());
    this.clearApiKeyButton.addEventListener('click', () => this.clearApiKey());
    
    // Close modal when clicking outside
    window.addEventListener('click', (event) => {
      if (event.target === this.apiKeyModal) {
        this.closeApiKeyModal();
      }
    });
    
    // Check and display current API key status
    this.updateApiKeyStatus();
    
    // If no API key is found, show the API key modal after a short delay
    setTimeout(() => {
      if (!localStorage.getItem('gemini_api_key')) {
        this.openApiKeyModal();
        // Show a message indicating that an API key is required
        this.apiKeyStatus.textContent = 'An API key is required to use this app. Get one for free from Google AI Studio.';
        this.apiKeyStatus.style.color = 'var(--color-text-secondary)';
      }
    }, 500);
  }

  private checkApiKeyThen(callback: Function): void {
    if (!localStorage.getItem('gemini_api_key')) {
      this.openApiKeyModal();
      this.apiKeyStatus.textContent = 'An API key is required to use this feature.';
      this.apiKeyStatus.style.color = 'var(--color-text-secondary)';
      return;
    }
    callback();
  }

  private handleResize(): void {
    if (
      this.isRecording &&
      this.liveWaveformCanvas &&
      this.liveWaveformCanvas.style.display === 'block'
    ) {
      requestAnimationFrame(() => {
        this.setupCanvasDimensions();
      });
    }
  }

  private setupCanvasDimensions(): void {
    if (!this.liveWaveformCanvas || !this.liveWaveformCtx) return;

    const canvas = this.liveWaveformCanvas;
    const dpr = window.devicePixelRatio || 1;

    const rect = canvas.getBoundingClientRect();
    const cssWidth = rect.width;
    const cssHeight = rect.height;

    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(cssHeight * dpr);

    this.liveWaveformCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private initTheme(): void {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'light') {
      document.body.classList.add('light-mode');
      this.themeToggleIcon.classList.remove('fa-sun');
      this.themeToggleIcon.classList.add('fa-moon');
    } else {
      document.body.classList.remove('light-mode');
      this.themeToggleIcon.classList.remove('fa-moon');
      this.themeToggleIcon.classList.add('fa-sun');
    }
  }

  private toggleTheme(): void {
    document.body.classList.toggle('light-mode');
    if (document.body.classList.contains('light-mode')) {
      localStorage.setItem('theme', 'light');
      this.themeToggleIcon.classList.remove('fa-sun');
      this.themeToggleIcon.classList.add('fa-moon');
    } else {
      localStorage.setItem('theme', 'dark');
      this.themeToggleIcon.classList.remove('fa-moon');
      this.themeToggleIcon.classList.add('fa-sun');
    }
  }

  private async toggleRecording(): Promise<void> {
    // Prevent rapid clicking/consecutive calls
    if (this.isProcessing) {
      console.log('Recording operation in progress, please wait...');
      return;
    }
    
    this.isProcessing = true;
    
    try {
      if (!this.isRecording) {
        await this.startRecording();
      } else {
        await this.stopRecording();
      }
    } catch (error) {
      console.error('Error toggling recording:', error);
    } finally {
      // Add a small delay before allowing another toggle
      setTimeout(() => {
        this.isProcessing = false;
      }, 1000); // 1 second debounce
    }
  }

  private setupAudioVisualizer(): void {
    if (!this.stream || this.audioContext) return;

    this.audioContext = new (window.AudioContext ||
      (window as any).webkitAudioContext)();
    const source = this.audioContext.createMediaStreamSource(this.stream);
    this.analyserNode = this.audioContext.createAnalyser();

    this.analyserNode.fftSize = 256;
    this.analyserNode.smoothingTimeConstant = 0.75;

    const bufferLength = this.analyserNode.frequencyBinCount;
    this.waveformDataArray = new Uint8Array(bufferLength);

    source.connect(this.analyserNode);
  }

  private drawLiveWaveform(): void {
    if (
      !this.analyserNode ||
      !this.waveformDataArray ||
      !this.liveWaveformCtx ||
      !this.liveWaveformCanvas ||
      !this.isRecording
    ) {
      if (this.waveformDrawingId) cancelAnimationFrame(this.waveformDrawingId);
      this.waveformDrawingId = null;
      return;
    }

    this.waveformDrawingId = requestAnimationFrame(() =>
      this.drawLiveWaveform(),
    );
    this.analyserNode.getByteFrequencyData(this.waveformDataArray);

    const ctx = this.liveWaveformCtx;
    const canvas = this.liveWaveformCanvas;

    const logicalWidth = canvas.clientWidth;
    const logicalHeight = canvas.clientHeight;

    ctx.clearRect(0, 0, logicalWidth, logicalHeight);

    const bufferLength = this.analyserNode.frequencyBinCount;
    const numBars = Math.floor(bufferLength * 0.5);

    if (numBars === 0) return;

    const totalBarPlusSpacingWidth = logicalWidth / numBars;
    const barWidth = Math.max(1, Math.floor(totalBarPlusSpacingWidth * 0.7));
    const barSpacing = Math.max(0, Math.floor(totalBarPlusSpacingWidth * 0.3));

    let x = 0;

    const recordingColor =
      getComputedStyle(document.documentElement)
        .getPropertyValue('--color-recording')
        .trim() || '#ff3b30';
    ctx.fillStyle = recordingColor;

    for (let i = 0; i < numBars; i++) {
      if (x >= logicalWidth) break;

      const dataIndex = Math.floor(i * (bufferLength / numBars));
      const barHeightNormalized = this.waveformDataArray[dataIndex] / 255.0;
      let barHeight = barHeightNormalized * logicalHeight;

      if (barHeight < 1 && barHeight > 0) barHeight = 1;
      barHeight = Math.round(barHeight);

      const y = Math.round((logicalHeight - barHeight) / 2);

      ctx.fillRect(Math.floor(x), y, barWidth, barHeight);
      x += barWidth + barSpacing;
    }
  }

  private updateLiveTimer(): void {
    if (!this.isRecording || !this.liveRecordingTimerDisplay) return;
    const now = Date.now();
    const elapsedMs = now - this.recordingStartTime;

    const totalSeconds = Math.floor(elapsedMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const hundredths = Math.floor((elapsedMs % 1000) / 10);

    this.liveRecordingTimerDisplay.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(hundredths).padStart(2, '0')}`;
  }

  private startLiveDisplay(): void {
    if (
      !this.recordingInterface ||
      !this.liveRecordingTitle ||
      !this.liveWaveformCanvas ||
      !this.liveRecordingTimerDisplay
    ) {
      console.warn(
        'One or more live display elements are missing. Cannot start live display.',
      );
      return;
    }

    this.recordingInterface.classList.add('is-live');
    this.liveRecordingTitle.style.display = 'block';
    this.liveWaveformCanvas.style.display = 'block';
    this.liveRecordingTimerDisplay.style.display = 'block';

    this.setupCanvasDimensions();

    if (this.statusIndicatorDiv) this.statusIndicatorDiv.style.display = 'none';

    const iconElement = this.recordButton.querySelector(
      '.record-button-inner i',
    ) as HTMLElement;
    if (iconElement) {
      iconElement.classList.remove('fa-microphone');
      iconElement.classList.add('fa-stop');
    }

    const currentTitle = this.editorTitle.textContent?.trim();
    const placeholder =
      this.editorTitle.getAttribute('placeholder') || 'Untitled Note';
    this.liveRecordingTitle.textContent =
      currentTitle && currentTitle !== placeholder
        ? currentTitle
        : 'New Recording';

    this.setupAudioVisualizer();
    this.drawLiveWaveform();

    this.recordingStartTime = Date.now();
    this.updateLiveTimer();
    if (this.timerIntervalId) clearInterval(this.timerIntervalId);
    this.timerIntervalId = window.setInterval(() => this.updateLiveTimer(), 50);
  }

  private stopLiveDisplay(): void {
    if (
      !this.recordingInterface ||
      !this.liveRecordingTitle ||
      !this.liveWaveformCanvas ||
      !this.liveRecordingTimerDisplay
    ) {
      if (this.recordingInterface)
        this.recordingInterface.classList.remove('is-live');
      return;
    }
    this.recordingInterface.classList.remove('is-live');
    this.liveRecordingTitle.style.display = 'none';
    this.liveWaveformCanvas.style.display = 'none';
    this.liveRecordingTimerDisplay.style.display = 'none';

    if (this.statusIndicatorDiv)
      this.statusIndicatorDiv.style.display = 'block';

    const iconElement = this.recordButton.querySelector(
      '.record-button-inner i',
    ) as HTMLElement;
    if (iconElement) {
      iconElement.classList.remove('fa-stop');
      iconElement.classList.add('fa-microphone');
    }

    if (this.waveformDrawingId) {
      cancelAnimationFrame(this.waveformDrawingId);
      this.waveformDrawingId = null;
    }
    if (this.timerIntervalId) {
      clearInterval(this.timerIntervalId);
      this.timerIntervalId = null;
    }
    if (this.liveWaveformCtx && this.liveWaveformCanvas) {
      this.liveWaveformCtx.clearRect(
        0,
        0,
        this.liveWaveformCanvas.width,
        this.liveWaveformCanvas.height,
      );
    }

    if (this.audioContext) {
      if (this.audioContext.state !== 'closed') {
        this.audioContext
          .close()
          .catch((e) => console.warn('Error closing audio context', e));
      }
      this.audioContext = null;
    }
    this.analyserNode = null;
    this.waveformDataArray = null;
  }

  private async startRecording(): Promise<void> {
    try {
      this.audioChunks = [];
      if (this.stream) {
        this.stream.getTracks().forEach((track) => track.stop());
        this.stream = null;
      }
      if (this.audioContext && this.audioContext.state !== 'closed') {
        await this.audioContext.close();
        this.audioContext = null;
      }

      this.recordingStatus.textContent = 'Requesting microphone access...';

      try {
        this.stream = await navigator.mediaDevices.getUserMedia({audio: true});
      } catch (err) {
        console.error('Failed with basic constraints:', err);
        this.stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
        });
      }

      try {
        this.mediaRecorder = new MediaRecorder(this.stream, {
          mimeType: 'audio/webm',
        });
      } catch (e) {
        console.error('audio/webm not supported, trying default:', e);
        this.mediaRecorder = new MediaRecorder(this.stream);
      }

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0)
          this.audioChunks.push(event.data);
      };

      this.mediaRecorder.onstop = () => {
        this.stopLiveDisplay();

        if (this.audioChunks.length > 0) {
          const audioBlob = new Blob(this.audioChunks, {
            type: this.mediaRecorder?.mimeType || 'audio/webm',
          });
          this.processAudio(audioBlob).catch((err) => {
            console.error('Error processing audio:', err);
            this.recordingStatus.textContent = 'Error processing recording';
            this.isProcessing = false;
          });
        } else {
          this.recordingStatus.textContent =
            'No audio data captured. Please try again.';
          this.isProcessing = false;
        }

        if (this.stream) {
          this.stream.getTracks().forEach((track) => {
            track.stop();
          });
          this.stream = null;
        }
      };

      this.mediaRecorder.start();
      this.isRecording = true;

      this.recordButton.classList.add('recording');
      this.recordButton.setAttribute('title', 'Stop Recording');

      this.startLiveDisplay();
    } catch (error) {
      console.error('Error starting recording:', error);
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const errorName = error instanceof Error ? error.name : 'Unknown';

      if (
        errorName === 'NotAllowedError' ||
        errorName === 'PermissionDeniedError'
      ) {
        this.recordingStatus.textContent =
          'Microphone permission denied. Please check browser settings and reload page.';
      } else if (
        errorName === 'NotFoundError' ||
        (errorName === 'DOMException' &&
          errorMessage.includes('Requested device not found'))
      ) {
        this.recordingStatus.textContent =
          'No microphone found. Please connect a microphone.';
      } else if (
        errorName === 'NotReadableError' ||
        errorName === 'AbortError' ||
        (errorName === 'DOMException' &&
          errorMessage.includes('Failed to allocate audiosource'))
      ) {
        this.recordingStatus.textContent =
          'Cannot access microphone. It may be in use by another application.';
      } else {
        this.recordingStatus.textContent = `Error: ${errorMessage}`;
      }

      this.isRecording = false;
      if (this.stream) {
        this.stream.getTracks().forEach((track) => track.stop());
        this.stream = null;
      }
      this.recordButton.classList.remove('recording');
      this.recordButton.setAttribute('title', 'Start Recording');
      this.stopLiveDisplay();
    }
  }

  private async stopRecording(): Promise<void> {
    if (this.mediaRecorder && this.isRecording) {
      try {
        this.mediaRecorder.stop();
      } catch (e) {
        console.error('Error stopping MediaRecorder:', e);
        this.stopLiveDisplay();
      }

      this.isRecording = false;

      this.recordButton.classList.remove('recording');
      this.recordButton.setAttribute('title', 'Start Recording');
      this.recordingStatus.textContent = 'Processing audio...';
    } else {
      if (!this.isRecording) this.stopLiveDisplay();
    }
  }

  private async processAudio(audioBlob: Blob): Promise<void> {
    console.log('Process audio started with blob:', audioBlob.type, audioBlob.size);
    
    if (audioBlob.size === 0) {
      this.recordingStatus.textContent =
        'No audio data captured. Please try again.';
      this.isProcessing = false;
      return;
    }
    
    // Check if API key is available
    if (!localStorage.getItem('gemini_api_key')) {
      console.log('No API key in localStorage');
      this.recordingStatus.textContent = 'API key required to process audio.';
      this.openApiKeyModal();
      this.apiKeyStatus.textContent = 'An API key is required to process audio.';
      this.apiKeyStatus.style.color = 'var(--color-text-secondary)';
      this.isProcessing = false;
      return;
    }

    try {
      const objectUrl = URL.createObjectURL(audioBlob);
      console.log('Created object URL:', objectUrl);

      this.recordingStatus.textContent = 'Converting audio...';

      const reader = new FileReader();
      const readResult = new Promise<string>((resolve, reject) => {
        reader.onloadend = () => {
          try {
            const base64data = reader.result as string;
            console.log('Audio file read, converting to base64');
            const base64Audio = base64data.split(',')[1];
            resolve(base64Audio);
          } catch (err) {
            console.error('Error in FileReader onloadend:', err);
            reject(err);
          }
        };
        reader.onerror = () => {
          console.error('FileReader error:', reader.error);
          reject(reader.error);
        };
      });
      reader.readAsDataURL(audioBlob);
      console.log('FileReader started');
      
      const base64Audio = await readResult;
      console.log('Base64 conversion complete, length:', base64Audio?.length);

      if (!base64Audio) {
        console.error('Base64 audio is empty or null');
        throw new Error('Failed to convert audio to base64');
      }

      const mimeType = this.mediaRecorder?.mimeType || audioBlob.type || 'audio/webm';
      console.log('Using mime type for transcription:', mimeType);
      await this.getTranscription(base64Audio, mimeType);
      
      // Reset processing state after successful processing
      this.isProcessing = false;
    } catch (error) {
      console.error('Detailed error in processAudio:', error);
      if (error instanceof Error) {
        console.error('Error name:', error.name);
        console.error('Error message:', error.message);
        console.error('Error stack:', error.stack);
      }
      this.recordingStatus.textContent =
        'Error processing recording. Please try again.';
      this.isProcessing = false;
    }
  }

  private async getTranscription(
    base64Audio: string,
    mimeType: string,
  ): Promise<void> {
    try {
      console.log('getTranscription started with mimetype:', mimeType);
      
      // Check if API key is available
      if (!this.genAI) {
        console.log('genAI client not initialized in getTranscription');
        this.recordingStatus.textContent = 'API key required to get transcription.';
        this.openApiKeyModal();
        this.apiKeyStatus.textContent = 'An API key is required to transcribe audio.';
        this.apiKeyStatus.style.color = 'var(--color-text-secondary)';
        this.isProcessing = false; // Reset processing flag
        return;
      }
      
      this.recordingStatus.textContent = 'Getting transcription...';

      // Get the model
      const model = this.genAI.getGenerativeModel({ model: MODEL_NAME });
      
      // Setup prompt for audio transcription
      const prompt = "Transcribe this audio file verbatim, include all spoken words.";
      
      // Create audio part with the proper MIME type
      console.log('Creating content parts for the transcription request');
      const audioData = { data: base64Audio, mimeType };
      
      try {
        console.log('Sending transcription request to Gemini API');
        // Send request using the generative model API
        const result = await model.generateContent([prompt, audioData]);
        const response = await result.response;
        console.log('Transcription API response received');
        
        // Get the text from the response
        const transcriptionText = response.text();
        console.log('Transcription text:', transcriptionText ? transcriptionText.substring(0, 100) + '...' : 'null');

        if (transcriptionText && transcriptionText.trim()) {
          this.rawTranscription.textContent = transcriptionText;
          this.rawTranscription.classList.remove('placeholder-active');
          console.log('Transcription complete - content added to UI');

          if (this.currentNote)
            this.currentNote.rawTranscription = transcriptionText;
          this.recordingStatus.textContent =
            'Transcription complete. Polishing note...';
          
          console.log('Starting note polishing');
          this.getPolishedNote().catch((err) => {
            console.error('Error polishing note:', err);
            this.recordingStatus.textContent =
              'Error polishing note after transcription.';
          });
        } else {
          console.log('No transcription text in response');
          this.recordingStatus.textContent =
            'Transcription failed or returned empty.';
          this.polishedNote.innerHTML =
            '<p><em>Could not transcribe audio. Please try again.</em></p>';
          this.rawTranscription.textContent =
            this.rawTranscription.getAttribute('placeholder') || '';
          this.rawTranscription.classList.add('placeholder-active');
        }
      } catch (apiError) {
        console.error('API error during transcription:', apiError);
        if (apiError instanceof Error) {
          console.error('API error name:', apiError.name);
          console.error('API error message:', apiError.message);
          console.error('API error stack:', apiError.stack);
        }
        throw apiError;
      }
    } catch (error) {
      console.error('Error in getTranscription:', error);
      this.recordingStatus.textContent =
        'Error getting transcription. Please try again.';
      this.polishedNote.innerHTML = `<p><em>Error during transcription: ${error instanceof Error ? error.message : String(error)}</em></p>`;
      this.rawTranscription.textContent =
        this.rawTranscription.getAttribute('placeholder') || '';
      this.rawTranscription.classList.add('placeholder-active');
      this.isProcessing = false; // Make sure to reset processing flag on error
    }
  }

  private async getPolishedNote(): Promise<void> {
    if (!this.rawTranscription.textContent?.trim()) {
      this.recordingStatus.textContent =
        'No transcription available to polish.';
      return;
    }
    
    // Check if API key is available
    if (!this.genAI) {
      this.recordingStatus.textContent = 'API key required to polish note.';
      this.openApiKeyModal();
      this.apiKeyStatus.textContent = 'An API key is required to polish notes.';
      this.apiKeyStatus.style.color = 'var(--color-text-secondary)';
      return;
    }

    try {
      this.recordingStatus.textContent = 'Polishing note...';

      const prompt = `Take this raw transcription and create a polished, well-formatted note.
                    Remove filler words (um, uh, like), repetitions, and false starts.
                    Format any lists or bullet points properly. Use markdown formatting for headings, lists, etc.
                    Maintain all the original content and meaning. Provide note only. Do not provide no other text or comments.

                    Raw transcription:
                    ${this.rawTranscription.textContent}`;
      const contents = [{text: prompt}];

      const response = await this.genAI.models.generateContent({
        model: MODEL_NAME,
        contents: contents,
      });
      const polishedText = response.text;

      if (polishedText) {
        const htmlContent = marked.parse(polishedText);
        this.polishedNote.innerHTML = htmlContent;
        if (polishedText.trim() !== '') {
          this.polishedNote.classList.remove('placeholder-active');
        } else {
          const placeholder =
            this.polishedNote.getAttribute('placeholder') || '';
          this.polishedNote.innerHTML = placeholder;
          this.polishedNote.classList.add('placeholder-active');
        }

        let noteTitleSet = false;
        const lines = polishedText.split('\n').map((l: string) => l.trim());

        for (const line of lines) {
          if (line.startsWith('#')) {
            const title = line.replace(/^#+\s+/, '').trim();
            if (this.editorTitle && title) {
              this.editorTitle.textContent = title;
              this.editorTitle.classList.remove('placeholder-active');
              noteTitleSet = true;
              break;
            }
          }
        }

        if (!noteTitleSet && this.editorTitle) {
          for (const line of lines) {
            if (line.length > 0) {
              let potentialTitle = line.replace(
                /^[\*_\`#\->\s\[\]\(.\d)]+/,
                '',
              );
              potentialTitle = potentialTitle.replace(/[\*_\`#]+$/, '');
              potentialTitle = potentialTitle.trim();

              if (potentialTitle.length > 3) {
                const maxLength = 60;
                this.editorTitle.textContent =
                  potentialTitle.substring(0, maxLength) +
                  (potentialTitle.length > maxLength ? '...' : '');
                this.editorTitle.classList.remove('placeholder-active');
                noteTitleSet = true;
                break;
              }
            }
          }
        }

        if (!noteTitleSet && this.editorTitle) {
          const currentEditorText = this.editorTitle.textContent?.trim();
          const placeholderText =
            this.editorTitle.getAttribute('placeholder') || 'Untitled Note';
          if (
            currentEditorText === '' ||
            currentEditorText === placeholderText
          ) {
            this.editorTitle.textContent = placeholderText;
            if (!this.editorTitle.classList.contains('placeholder-active')) {
              this.editorTitle.classList.add('placeholder-active');
            }
          }
        }

        if (this.currentNote) this.currentNote.polishedNote = polishedText;
        this.recordingStatus.textContent =
          'Note polished. Ready for next recording.';
      } else {
        this.recordingStatus.textContent =
          'Polishing failed or returned empty.';
        this.polishedNote.innerHTML =
          '<p><em>Polishing returned empty. Raw transcription is available.</em></p>';
        if (
          this.polishedNote.textContent?.trim() === '' ||
          this.polishedNote.innerHTML.includes('<em>Polishing returned empty')
        ) {
          const placeholder =
            this.polishedNote.getAttribute('placeholder') || '';
          this.polishedNote.innerHTML = placeholder;
          this.polishedNote.classList.add('placeholder-active');
        }
      }
    } catch (error) {
      console.error('Error polishing note:', error);
      this.recordingStatus.textContent =
        'Error polishing note. Please try again.';
      this.polishedNote.innerHTML = `<p><em>Error during polishing: ${error instanceof Error ? error.message : String(error)}</em></p>`;
      if (
        this.polishedNote.textContent?.trim() === '' ||
        this.polishedNote.innerHTML.includes('<em>Error during polishing')
      ) {
        const placeholder = this.polishedNote.getAttribute('placeholder') || '';
        this.polishedNote.innerHTML = placeholder;
        this.polishedNote.classList.add('placeholder-active');
      }
    }
  }

  private createNewNote(): void {
    this.currentNote = {
      id: `note_${Date.now()}`,
      rawTranscription: '',
      polishedNote: '',
      timestamp: Date.now(),
    };

    const rawPlaceholder =
      this.rawTranscription.getAttribute('placeholder') || '';
    this.rawTranscription.textContent = rawPlaceholder;
    this.rawTranscription.classList.add('placeholder-active');

    const polishedPlaceholder =
      this.polishedNote.getAttribute('placeholder') || '';
    this.polishedNote.innerHTML = polishedPlaceholder;
    this.polishedNote.classList.add('placeholder-active');

    if (this.editorTitle) {
      const placeholder =
        this.editorTitle.getAttribute('placeholder') || 'Untitled Note';
      this.editorTitle.textContent = placeholder;
      this.editorTitle.classList.add('placeholder-active');
    }
    this.recordingStatus.textContent = 'Ready to record';

    if (this.isRecording) {
      this.mediaRecorder?.stop();
      this.isRecording = false;
      this.recordButton.classList.remove('recording');
    } else {
      this.stopLiveDisplay();
    }
  }

  // Add a new method to handle file uploads
  private async handleFileUpload(event: Event): Promise<void> {
    const target = event.target as HTMLInputElement;
    const files = target.files;
    
    console.log('File upload event triggered', files);
    
    if (!files || files.length === 0) {
      this.recordingStatus.textContent = 'No file selected.';
      return;
    }
    
    // Check if API key is available
    if (!this.genAI) {
      console.log('No API key available for file upload');
      this.recordingStatus.textContent = 'API key required to process audio files.';
      this.openApiKeyModal();
      this.apiKeyStatus.textContent = 'An API key is required to process audio files.';
      this.apiKeyStatus.style.color = 'var(--color-text-secondary)';
      return;
    }
    
    const audioFile = files[0];
    console.log('Audio file selected:', audioFile.name, audioFile.type, audioFile.size);
    
    // Check if the file is an audio file
    if (!audioFile.type.startsWith('audio/')) {
      this.recordingStatus.textContent = 'Please select an audio file.';
      return;
    }
    
    this.recordingStatus.textContent = 'Processing uploaded audio...';
    this.isProcessing = true; // Set processing flag
    
    try {
      // Process the uploaded audio file
      console.log('Starting to process audio file');
      await this.processAudio(audioFile);
      console.log('Finished processing audio file');
      
      // Reset the file input for future uploads
      this.audioFileInput.value = '';
    } catch (error) {
      console.error('Error processing uploaded audio:', error);
      this.recordingStatus.textContent = 'Error processing the audio file. Please try again.';
      this.isProcessing = false; // Reset processing flag
    }
  }

  private openApiKeyModal(): void {
    if (this.apiKeyModal) {
      // Check if there's an existing API key and pre-fill the input
      const storedApiKey = localStorage.getItem('gemini_api_key');
      if (storedApiKey) {
        this.apiKeyInput.value = storedApiKey;
      }
      
      // Display the modal
      this.apiKeyModal.style.display = 'block';
    }
  }

  private closeApiKeyModal(): void {
    if (this.apiKeyModal) {
      this.apiKeyModal.style.display = 'none';
    }
  }

  private saveApiKey(): void {
    const apiKey = this.apiKeyInput.value.trim();
    
    if (!apiKey) {
      this.apiKeyStatus.textContent = 'API key cannot be empty.';
      this.apiKeyStatus.style.color = 'var(--color-recording)';
      return;
    }
    
    try {
      // Save the API key to localStorage
      localStorage.setItem('gemini_api_key', apiKey);
      
      // Initialize the API client with the new key
      this.genAI = new GoogleGenAI({
        apiKey: apiKey,
      });
      
      // Update UI
      this.apiKeyStatus.textContent = 'API key saved successfully!';
      this.apiKeyStatus.style.color = 'var(--color-success)';
      this.settingsButton.classList.add('custom-key-active');
      
      // Close modal after a brief delay
      setTimeout(() => {
        this.closeApiKeyModal();
      }, 1500);
    } catch (error) {
      console.error('Error saving API key:', error);
      this.apiKeyStatus.textContent = 'Error saving API key.';
      this.apiKeyStatus.style.color = 'var(--color-recording)';
    }
  }

  private clearApiKey(): void {
    try {
      // Remove API key from localStorage
      localStorage.removeItem('gemini_api_key');
      
      // Clear the input field
      this.apiKeyInput.value = '';
      
      // Reset the API client
      this.genAI = null;
      
      // Update status
      this.apiKeyStatus.textContent = 'API key removed. App functionality will be limited until a new key is provided.';
      this.apiKeyStatus.style.color = 'var(--color-text-secondary)';
      
      // Remove custom key indicator
      this.settingsButton.classList.remove('custom-key-active');
      
    } catch (error) {
      console.error('Error clearing API key:', error);
      this.apiKeyStatus.textContent = 'Error clearing API key.';
      this.apiKeyStatus.style.color = 'var(--color-recording)';
    }
  }

  private updateApiKeyStatus(): void {
    const storedApiKey = localStorage.getItem('gemini_api_key');
    
    if (storedApiKey) {
      this.settingsButton.setAttribute('title', 'Settings (Using Custom API Key)');
      // Add a visual indicator that a custom key is being used
      this.settingsButton.classList.add('custom-key-active');
    } else {
      this.settingsButton.setAttribute('title', 'Settings (Using Default API Key)');
      this.settingsButton.classList.remove('custom-key-active');
    }
  }

  public async init(): Promise<void> {
    this.bindEventListeners();
    this.loadTheme();
    this.updateApiKeyStatus();
    
    // Check if we have an API key and update UI accordingly
    const storedApiKey = localStorage.getItem('gemini_api_key');
    if (storedApiKey) {
      this.settingsButton.classList.add('custom-key-active');
      this.recordingStatus.textContent = 'Ready to record. Click the microphone to start.';
    } else {
      this.recordingStatus.textContent = 'API key required. Click the settings icon to add your key.';
    }
  }

  private loadTheme(): void {
    const storedTheme = localStorage.getItem('theme');
    if (storedTheme === 'dark') {
      document.body.classList.add('dark-theme');
      this.themeToggleIcon.classList.remove('fa-sun');
      this.themeToggleIcon.classList.add('fa-moon');
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const app = new VoiceNotesApp();
  app.init();

  document
    .querySelectorAll<HTMLElement>('[contenteditable][placeholder]')
    .forEach((el) => {
      const placeholder = el.getAttribute('placeholder')!;

      function updatePlaceholderState() {
        const currentText = (
          el.id === 'polishedNote' ? el.innerText : el.textContent
        )?.trim();

        if (currentText === '' || currentText === placeholder) {
          if (el.id === 'polishedNote' && currentText === '') {
            el.innerHTML = placeholder;
          } else if (currentText === '') {
            el.textContent = placeholder;
          }
          el.classList.add('placeholder-active');
        } else {
          el.classList.remove('placeholder-active');
        }
      }

      updatePlaceholderState();

      el.addEventListener('focus', function () {
        const currentText = (
          this.id === 'polishedNote' ? this.innerText : this.textContent
        )?.trim();
        if (currentText === placeholder) {
          if (this.id === 'polishedNote') this.innerHTML = '';
          else this.textContent = '';
          this.classList.remove('placeholder-active');
        }
      });

      el.addEventListener('blur', function () {
        updatePlaceholderState();
      });
    });
});

export {};
