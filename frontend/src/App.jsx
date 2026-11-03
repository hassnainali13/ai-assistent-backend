import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Activity,
  AlertCircle,
  ArrowDownToLine,
  Bot,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  Database,
  FileText,
  FileUp,
  LoaderCircle,
  MessageSquare,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import './App.css'

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:5001').replace(/\/$/, '')
const MAX_FILE_SIZE = 20 * 1024 * 1024
const MAX_TRAINING_TEXT_SIZE = 3 * 1024 * 1024
const MAX_PANEL_IMAGE_SIZE = 2.5 * 1024 * 1024

async function extractText(file) {
  if (file.name.toLowerCase().endsWith('.pdf')) {
    const pdfjs = await import('pdfjs-dist')
    const { default: pdfWorker } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
    pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker
    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(await file.arrayBuffer()),
    })
    const document = await loadingTask.promise
    const pages = []

    try {
      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
        const page = await document.getPage(pageNumber)
        const content = await page.getTextContent()
        const pageText = content.items
          .map((item) => ('str' in item ? item.str : ''))
          .filter(Boolean)
          .join(' ')
        pages.push(pageText)
      }

      return pages.join('\n\n').trim()
    } finally {
      await loadingTask.destroy()
    }
  }

  return (await file.text()).trim()
}

function formatFileSize(bytes) {
  if (!bytes) return '0 KB'
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(value) {
  if (!value) return 'Just now'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Recently added'
  return new Intl.DateTimeFormat('en', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date)
}

async function readError(response, fallback) {
  try {
    const data = await response.json()
    return data.error || data.message || fallback
  } catch {
    return fallback
  }
}

async function fetchDocuments() {
  const response = await fetch(`${API_BASE_URL}/api/documents`)
  if (!response.ok) {
    throw new Error(await readError(response, 'Could not load your documents.'))
  }
  const data = await response.json()
  return Array.isArray(data) ? data : []
}

async function fetchPanelImages() {
  const response = await fetch(`${API_BASE_URL}/api/panel-images`)
  if (!response.ok) {
    throw new Error(await readError(response, 'Could not load panel images.'))
  }
  const data = await response.json()
  return Array.isArray(data) ? data : []
}

const CHAT_STORAGE_KEY = 'hassnain-ai-bot-messages'
const CHAT_TIMESTAMP_KEY = 'hassnain-ai-bot-lastActive'
const CHAT_EXPIRATION_MS = 10 * 60 * 1000
const CHAT_WELCOME_MESSAGE = {
  role: 'assistant',
  content: '**Welcome!** I am Hassnain Ali’s AI assistant. I can help with his portfolio, skills, projects, and professional details.',
}
const SUGGESTED_QUESTIONS = [
  'What was Hassnain’s SQA experience?',
  'Tell me about the EPMS project.',
  'Which technologies does he use?',
]

function loadChatMessages() {
  try {
    const lastActive = Number(window.localStorage.getItem(CHAT_TIMESTAMP_KEY))
    const storedMessages = window.localStorage.getItem(CHAT_STORAGE_KEY)
    const age = Date.now() - lastActive
    if (storedMessages && Number.isFinite(age) && age >= 0 && age < CHAT_EXPIRATION_MS) {
      const parsed = JSON.parse(storedMessages)
      if (Array.isArray(parsed)) {
        const messages = parsed
          .filter((message) => message && ['assistant', 'bot', 'user'].includes(message.role) && typeof message.content === 'string')
          .map((message) => ({ ...message, role: message.role === 'bot' ? 'assistant' : message.role }))
        if (messages.length) return messages
      }
    }
    window.localStorage.removeItem(CHAT_STORAGE_KEY)
    window.localStorage.removeItem(CHAT_TIMESTAMP_KEY)
  } catch {
    window.localStorage.removeItem(CHAT_STORAGE_KEY)
    window.localStorage.removeItem(CHAT_TIMESTAMP_KEY)
  }
  return [CHAT_WELCOME_MESSAGE]
}

function renderInlineText(text) {
  return text.split(/(\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_)/g).map((part, index) => {
    if ((part.startsWith('**') && part.endsWith('**')) || (part.startsWith('__') && part.endsWith('__'))) {
      return <strong key={index}>{part.slice(2, -2)}</strong>
    }
    if ((part.startsWith('*') && part.endsWith('*')) || (part.startsWith('_') && part.endsWith('_'))) {
      return <em key={index}>{part.slice(1, -1)}</em>
    }
    return part
  })
}

function AssistantMessage({ content }) {
  return (
    <div className="assistant-copy">
      {content.split(/\r?\n/).map((line, index) => {
        const trimmed = line.trim()
        if (!trimmed) return <div className="chat-line-gap" key={index} />
        const heading = trimmed.match(/^#{1,3}\s+(.+)$/)
        if (heading) return <p className="chat-copy-heading" key={index}>{renderInlineText(heading[1])}</p>
        const bullet = trimmed.match(/^[-*]\s+(.+)$/)
        if (bullet) return <div className="chat-copy-bullet" key={index}><span aria-hidden="true">•</span><span>{renderInlineText(bullet[1])}</span></div>
        return <p key={index}>{renderInlineText(trimmed)}</p>
      })}
    </div>
  )
}

function ChatTester({ connection }) {
  const [isOpen, setIsOpen] = useState(false)
  const [messages, setMessages] = useState(loadChatMessages)
  const [draft, setDraft] = useState('')
  const [isSending, setIsSending] = useState(false)
  const messagesEndRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    try {
      window.localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(messages))
      window.localStorage.setItem(CHAT_TIMESTAMP_KEY, Date.now().toString())
    } catch {
      // Chat remains usable when browser storage is unavailable.
    }
  }, [messages])

  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
      inputRef.current?.focus()
    }
  }, [isOpen, isSending, messages])

  async function sendMessage(question = draft) {
    const userMessage = question.trim()
    if (!userMessage || isSending || connection !== 'online') return

    const userEntry = { role: 'user', content: userMessage }
    const conversation = [...messages, userEntry]
    setMessages(conversation)
    setDraft('')
    setIsSending(true)

    try {
      const response = await fetch(`${API_BASE_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userMessage, conversation }),
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.reply || data.error || 'Could not get a response from the assistant.')
      }
      setMessages((current) => [...current, {
        role: 'assistant',
        content: data.reply || 'No response from the assistant.',
      }])
    } catch (error) {
      setMessages((current) => [...current, {
        role: 'assistant',
        content: `⚠️ ${error.message || 'Server error. Try again.'}`,
      }])
    } finally {
      setIsSending(false)
    }
  }

  function handleKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void sendMessage()
    }
  }

  function startNewConversation() {
    setMessages([CHAT_WELCOME_MESSAGE])
    setDraft('')
  }

  return (
    <div className="chat-tester">
      {isOpen ? (
        <section className="chat-window" role="dialog" aria-label="Test assistant chat" aria-modal="false">
          <header className="chat-header">
            <div className="chat-brand-icon"><Bot size={20} /></div>
            <div className="chat-header-copy">
              <h2>Test assistant</h2>
              <span><i className={connection === 'online' ? 'chat-online-dot' : 'chat-offline-dot'} />{connection === 'online' ? 'Connected to portfolio API' : 'Backend unavailable'}</span>
            </div>
            <button type="button" className="chat-header-button" onClick={startNewConversation} aria-label="Start a new conversation" title="New conversation"><RotateCcw size={15} /></button>
            <button type="button" className="chat-header-button" onClick={() => setIsOpen(false)} aria-label="Close assistant chat" title="Close chat"><X size={18} /></button>
          </header>

          <div className="chat-messages" aria-live="polite" aria-relevant="additions text">
            {messages.map((message, index) => (
              <div className={`chat-message-row ${message.role === 'user' ? 'chat-message-user' : 'chat-message-assistant'}`} key={`${index}-${message.role}`}>
                {message.role !== 'user' && <span className="chat-message-avatar"><Bot size={14} /></span>}
                <div className="chat-bubble">
                  {message.role === 'user' ? message.content : <AssistantMessage content={message.content} />}
                </div>
              </div>
            ))}
            {messages.length === 1 && !isSending && (
              <div className="chat-suggestions" aria-label="Suggested questions">
                <span>TRY A QUESTION</span>
                {SUGGESTED_QUESTIONS.map((question) => (
                  <button type="button" key={question} onClick={() => void sendMessage(question)} disabled={connection !== 'online'}>{question}</button>
                ))}
              </div>
            )}
            {isSending && (
              <div className="chat-message-row chat-message-assistant">
                <span className="chat-message-avatar"><Bot size={14} /></span>
                <div className="chat-typing"><LoaderCircle className="spin" size={14} /> Assistant is thinking</div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <form className="chat-composer" onSubmit={(event) => { event.preventDefault(); void sendMessage() }}>
            <label className="visually-hidden" htmlFor="assistant-test-input">Ask a portfolio question</label>
            <textarea
              ref={inputRef}
              id="assistant-test-input"
              rows="2"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about skills, projects, or experience..."
              disabled={connection !== 'online'}
            />
            <button type="submit" className="chat-send-button" disabled={!draft.trim() || isSending || connection !== 'online'} aria-label="Send message" title="Send message">
              {isSending ? <LoaderCircle className="spin" size={16} /> : <Send size={16} />}
            </button>
            <p>Enter to send <span>·</span> Shift+Enter for a new line</p>
          </form>
        </section>
      ) : (
        <button type="button" className="chat-launcher" onClick={() => setIsOpen(true)} aria-label="Test assistant" aria-expanded={false}>
          <span className="chat-launcher-icon"><MessageSquare size={18} /></span>
          <span>Test assistant</span>
          <span className="chat-launcher-status" aria-hidden="true" />
        </button>
      )}
    </div>
  )
}

function App() {
  const fileInputRef = useRef(null)
  const panelImageInputRef = useRef(null)
  const [documents, setDocuments] = useState([])
  const [panelImages, setPanelImages] = useState([])
  const [selectedFile, setSelectedFile] = useState(null)
  const [selectedPanelImages, setSelectedPanelImages] = useState([])
  const [searchTerm, setSearchTerm] = useState('')
  const [panelImageUrl, setPanelImageUrl] = useState('')
  const [panelImageTitle, setPanelImageTitle] = useState('')
  const [panelImageDescription, setPanelImageDescription] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isUploading, setIsUploading] = useState(false)
  const [isSavingPanelImage, setIsSavingPanelImage] = useState(false)
  const [deletingId, setDeletingId] = useState(null)
  const [isDragging, setIsDragging] = useState(false)
  const [connection, setConnection] = useState('checking')
  const [notice, setNotice] = useState(null)

  const refreshDocuments = useCallback(async () => {
    setIsLoading(true)
    try {
      setDocuments(await fetchDocuments())
      setConnection('online')
    } catch {
      setConnection('offline')
      setNotice({
        kind: 'error',
        text: 'Backend is unavailable. Check that the API server is running.',
      })
    } finally {
      setIsLoading(false)
    }
  }, [])

  const refreshPanelImages = useCallback(async () => {
    try {
      setPanelImages(await fetchPanelImages())
    } catch (error) {
      setNotice({
        kind: 'error',
        text: error.message || 'Unable to load panel images.',
      })
    }
  }, [])

  useEffect(() => {
    let active = true

    Promise.all([fetchDocuments(), fetchPanelImages()])
      .then(([documentList, imageList]) => {
        if (!active) return
        setDocuments(documentList)
        setPanelImages(imageList)
        setConnection('online')
      })
      .catch(() => {
        if (!active) return
        setConnection('offline')
        setNotice({
          kind: 'error',
          text: 'Backend is unavailable. Check that the API server is running.',
        })
      })
      .finally(() => {
        if (active) setIsLoading(false)
      })

    return () => { active = false }
  }, [])

  const filteredDocuments = documents.filter((document) =>
    document.filename.toLowerCase().includes(searchTerm.trim().toLowerCase()),
  )

  function chooseFile(file) {
    setNotice(null)
    if (!file) return
    const isSupported = /\.(pdf|txt)$/i.test(file.name)
    if (!isSupported) {
      setSelectedFile(null)
      setNotice({ kind: 'error', text: 'Choose a PDF or TXT document.' })
      return
    }
    if (file.size > MAX_FILE_SIZE) {
      setSelectedFile(null)
      setNotice({ kind: 'error', text: 'Files must be smaller than 20 MB.' })
      return
    }
    setSelectedFile(file)
  }

  function choosePanelImages(files, input) {
    setNotice(null)
    const selectedImages = Array.from(files || [])
    if (!selectedImages.length) {
      setSelectedPanelImages([])
      return
    }
    if (selectedImages.some((file) => !file.type.startsWith('image/'))) {
      setSelectedPanelImages([])
      input.value = ''
      setNotice({ kind: 'error', text: 'Choose valid image files.' })
      return
    }
    if (selectedImages.some((file) => file.size > MAX_PANEL_IMAGE_SIZE)) {
      setSelectedPanelImages([])
      input.value = ''
      setNotice({ kind: 'error', text: 'Each panel image must be 2.5 MB or smaller.' })
      return
    }
    setSelectedPanelImages(selectedImages)
  }

  async function handleUpload(event) {
    event.preventDefault()
    if (!selectedFile || isUploading) return

    setIsUploading(true)
    setNotice(null)

    try {
      const text = await extractText(selectedFile)
      if (!text) {
        throw new Error('No text could be read. Scanned PDFs need OCR before upload.')
      }
      if (new Blob([text]).size > MAX_TRAINING_TEXT_SIZE) {
        throw new Error('Extracted document text must be 3 MB or smaller for upload.')
      }

      const formData = new FormData()
      formData.append(
        'file',
        new Blob([text], { type: 'text/plain' }),
        selectedFile.name,
      )
      const response = await fetch(`${API_BASE_URL}/api/train-txt`, {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        throw new Error(await readError(response, 'Document upload failed.'))
      }

      setNotice({ kind: 'success', text: `${selectedFile.name} added to the assistant's knowledge.` })
      setSelectedFile(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
      await refreshDocuments()
    } catch (error) {
      setNotice({ kind: 'error', text: error.message || 'Document upload failed.' })
    } finally {
      setIsUploading(false)
    }
  }

  async function handleDelete(document) {
    setDeletingId(document.id)
    setNotice(null)
    try {
      const response = await fetch(`${API_BASE_URL}/api/documents/${document.id}`, {
        method: 'DELETE',
      })
      if (!response.ok) {
        throw new Error(await readError(response, 'Could not remove this document.'))
      }
      setDocuments((current) => current.filter((item) => item.id !== document.id))
      setNotice({ kind: 'success', text: `${document.filename} removed.` })
    } catch (error) {
      setNotice({ kind: 'error', text: error.message || 'Could not remove this document.' })
    } finally {
      setDeletingId(null)
    }
  }

  async function handleSavePanelImage(event) {
    event.preventDefault()
    const trimmedUrl = panelImageUrl.trim()
    if ((!trimmedUrl && !selectedPanelImages.length) || isSavingPanelImage) return

    setIsSavingPanelImage(true)
    setNotice(null)

    try {
      const imagesToSave = selectedPanelImages.length ? selectedPanelImages : [null]
      const results = []

      for (const file of imagesToSave) {
        try {
          const title = panelImageTitle.trim() || file?.name.replace(/\.[^.]+$/, '') || 'Panel image'
          const imagePayload = {
            title,
            description: panelImageDescription.trim(),
            alt: title,
          }

          if (file) {
            const fileDataUrl = await new Promise((resolve, reject) => {
              const reader = new FileReader()
              reader.onload = () => resolve(reader.result)
              reader.onerror = () => reject(new Error(`Could not read ${file.name}.`))
              reader.readAsDataURL(file)
            })
            imagePayload.imageDataUrl = String(fileDataUrl)
          } else {
            imagePayload.imageUrl = trimmedUrl
          }

          const response = await fetch(`${API_BASE_URL}/api/panel-images`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(imagePayload),
          })

          if (!response.ok) {
            throw new Error(await readError(response, 'Panel image upload failed.'))
          }

          results.push({ status: 'fulfilled', value: await response.json() })
        } catch (reason) {
          results.push({ status: 'rejected', reason })
        }
      }

      const savedImages = results.flatMap((result) =>
        result.status === 'fulfilled' ? [result.value] : [],
      )
      const failedResults = results.filter((result) => result.status === 'rejected')

      if (savedImages.length) {
        setPanelImages((current) => [...savedImages, ...current])
      }

      if (failedResults.length) {
        const failedImages = results.flatMap((result, index) =>
          result.status === 'rejected' && imagesToSave[index] ? [imagesToSave[index]] : [],
        )
        setSelectedPanelImages(failedImages)
        if (panelImageInputRef.current) panelImageInputRef.current.value = ''
        const firstError = failedResults[0].reason?.message || 'Panel image upload failed.'
        setNotice({
          kind: 'error',
          text: `Saved ${savedImages.length} of ${imagesToSave.length} images. ${firstError}`,
        })
        return
      }

      setPanelImageUrl('')
      setPanelImageTitle('')
      setPanelImageDescription('')
      setSelectedPanelImages([])
      if (panelImageInputRef.current) panelImageInputRef.current.value = ''
      setNotice({
        kind: 'success',
        text: `${savedImages.length} panel image${savedImages.length === 1 ? '' : 's'} added to your portfolio gallery.`,
      })
    } catch (error) {
      setNotice({ kind: 'error', text: error.message || 'Panel image upload failed.' })
    } finally {
      setIsSavingPanelImage(false)
    }
  }

  async function handleDeletePanelImage(imageId) {
    try {
      const response = await fetch(`${API_BASE_URL}/api/panel-images/${imageId}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        throw new Error(await readError(response, 'Could not remove this panel image.'))
      }

      setPanelImages((current) => current.filter((item) => item.id !== imageId))
      setNotice({ kind: 'success', text: 'Panel image removed.' })
    } catch (error) {
      setNotice({ kind: 'error', text: error.message || 'Could not remove this panel image.' })
    }
  }

  function handleDrop(event) {
    event.preventDefault()
    setIsDragging(false)
    chooseFile(event.dataTransfer.files?.[0])
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#home" aria-label="Hassnain AI Studio home">
          <span className="brand-mark"><Sparkles size={17} strokeWidth={2.2} /></span>
          <span className="brand-copy"><strong>HASSNAIN</strong><small>AI STUDIO</small></span>
        </a>

        <div className="sidebar-label">WORKSPACE</div>
        <nav className="side-nav" aria-label="Workspace navigation">
          <a className="nav-item nav-item-active" href="#knowledge">
            <Database size={17} />
            <span>Knowledge base</span>
            <ChevronRight className="nav-chevron" size={15} />
          </a>
        </nav>

        <div className="sidebar-bottom">
          <div className="privacy-note">
            <ShieldCheck size={17} />
            <div><strong>Your workspace</strong><span>Connected to your backend</span></div>
          </div>
          <div className="profile-row">
            <div className="profile-avatar">HA</div>
            <div className="profile-copy"><strong>Hassnain Ali</strong><span>Portfolio assistant</span></div>
            <span className="profile-dot" aria-label="Active" />
          </div>
        </div>
      </aside>

      <main className="main-area" id="home">
        <header className="topbar">
          <div className="breadcrumbs"><span>Workspace</span><ChevronRight size={13} /><strong>Knowledge base</strong></div>
          <div className={`connection-status connection-${connection}`}>
            <span className="connection-dot" />
            {connection === 'checking' ? 'Connecting' : connection === 'online' ? 'API connected' : 'API offline'}
          </div>
        </header>

        <div className="page-content" id="knowledge">
          <section className="page-heading">
            <div className="heading-copy">
              <div className="eyebrow"><span className="eyebrow-line" /> ASSISTANT TRAINING <span className="eyebrow-index">/ 01</span></div>
              <h1>Knowledge base<span className="heading-period">.</span></h1>
              <p>Add CVs, project notes, and reference documents to shape your assistant&apos;s answers.</p>
            </div>
            <div className="heading-stats" aria-label="Knowledge base summary">
              <div className="stat-block"><span className="stat-value">{String(documents.length).padStart(2, '0')}</span><span className="stat-label">SOURCES</span></div>
              <span className="stat-divider" />
              <div className="stat-block"><span className="stat-value stat-live"><Activity size={17} /> LIVE</span><span className="stat-label">SYNC STATUS</span></div>
            </div>
          </section>

          {notice && (
            <div className={`notice notice-${notice.kind}`} role="status">
              {notice.kind === 'success' ? <CheckCircle2 size={17} /> : <AlertCircle size={17} />}
              <span>{notice.text}</span>
              <button type="button" className="icon-button notice-close" onClick={() => setNotice(null)} aria-label="Dismiss notification"><X size={16} /></button>
            </div>
          )}

          <section className="training-grid" aria-label="Add knowledge">
            <div className="upload-panel">
              <div className="section-title-row">
                <div><span className="section-kicker">ADD MATERIAL</span><h2>Teach with a document</h2></div>
                <span className="format-chip">PDF <i /> TXT</span>
              </div>

              <form onSubmit={handleUpload}>
                <label
                  className={`dropzone${isDragging ? ' dropzone-active' : ''}${selectedFile ? ' dropzone-has-file' : ''}`}
                  htmlFor="document-file"
                  onDragEnter={(event) => { event.preventDefault(); setIsDragging(true) }}
                  onDragOver={(event) => event.preventDefault()}
                  onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setIsDragging(false) }}
                  onDrop={handleDrop}
                >
                  <input
                    ref={fileInputRef}
                    id="document-file"
                    className="visually-hidden"
                    type="file"
                    accept=".pdf,.txt,application/pdf,text/plain"
                    onChange={(event) => chooseFile(event.target.files?.[0])}
                  />
                  {selectedFile ? (
                    <>
                      <span className="file-badge"><FileText size={21} /></span>
                      <span className="dropzone-copy"><strong>{selectedFile.name}</strong><span>{formatFileSize(selectedFile.size)} · Ready to upload</span></span>
                      <button type="button" className="icon-button clear-file" aria-label="Clear selected file" onClick={(event) => { event.preventDefault(); event.stopPropagation(); setSelectedFile(null); if (fileInputRef.current) fileInputRef.current.value = '' }}><X size={17} /></button>
                    </>
                  ) : (
                    <>
                      <span className="upload-symbol"><FileUp size={23} strokeWidth={1.7} /></span>
                      <span className="dropzone-copy"><strong>Drop your file here, or <em>browse</em></strong><span>PDF or plain text · Up to 20 MB (3 MB extracted text limit)</span></span>
                      <span className="dropzone-shortcut">SELECT FILE <ArrowDownToLine size={14} /></span>
                    </>
                  )}
                </label>

                <div className="upload-actions">
                  <p><CircleHelp size={15} /> PDF text is extracted in your browser before upload.</p>
                  <button type="submit" className="primary-button" disabled={!selectedFile || isUploading || connection !== 'online'}>
                    {isUploading ? <LoaderCircle className="spin" size={17} /> : <Upload size={16} />}
                    {isUploading ? 'Adding document' : 'Add to knowledge'}
                  </button>
                </div>
              </form>
            </div>

            <aside className="training-aside">
              <div className="aside-icon"><Sparkles size={18} /></div>
              <span className="section-kicker">HOW IT WORKS</span>
              <h2>Context, not fine-tuning.</h2>
              <p>Your files are saved as reference material. The assistant uses this context when answering portfolio questions.</p>
              <div className="aside-rule" />
              <div className="aside-foot"><span className="aside-number">01</span><span>Files stay in your connected MongoDB.</span></div>
              <div className="aside-foot"><span className="aside-number">02</span><span>Scanned PDFs need OCR before upload.</span></div>
            </aside>
          </section>

          <section className="training-grid" aria-label="Add panel images" style={{ marginTop: '28px' }}>
            <div className="upload-panel">
              <div className="section-title-row">
                <div><span className="section-kicker">ADD IMAGES</span><h2>Upload panel photos</h2></div>
                <span className="format-chip">URL <i /> IMAGE</span>
              </div>

              <form onSubmit={handleSavePanelImage} style={{ display: 'grid', gap: '18px' }}>
                <label style={{ display: 'grid', gap: '10px' }}>
                  <span className="section-kicker" style={{ fontSize: '11px', letterSpacing: '0.12em' }}>Title</span>
                  <input
                    type="text"
                    value={panelImageTitle}
                    onChange={(event) => setPanelImageTitle(event.target.value)}
                    placeholder="Main electrical panel"
                    className="search-field"
                    style={{ width: '100%', border: '1px solid rgba(148, 163, 184, 0.25)', background: '#0f172a', color: '#e2e8f0', borderRadius: '12px', padding: '12px 14px' }}
                  />
                </label>

                <label style={{ display: 'grid', gap: '10px' }}>
                  <span className="section-kicker" style={{ fontSize: '11px', letterSpacing: '0.12em' }}>Cloudinary or direct image URL</span>
                  <input
                    type="url"
                    value={panelImageUrl}
                    onChange={(event) => setPanelImageUrl(event.target.value)}
                    placeholder="https://res.cloudinary.com/.../panel-image.jpg"
                    className="search-field"
                    style={{ width: '100%', border: '1px solid rgba(148, 163, 184, 0.25)', background: '#0f172a', color: '#e2e8f0', borderRadius: '12px', padding: '12px 14px' }}
                  />
                </label>

                <label style={{ display: 'grid', gap: '10px' }}>
                  <span className="section-kicker" style={{ fontSize: '11px', letterSpacing: '0.12em' }}>Optional description</span>
                  <textarea
                    value={panelImageDescription}
                    onChange={(event) => setPanelImageDescription(event.target.value)}
                    rows={3}
                    placeholder="Installed in Karachi industrial project"
                    className="search-field"
                    style={{ width: '100%', border: '1px solid rgba(148, 163, 184, 0.25)', background: '#0f172a', color: '#e2e8f0', borderRadius: '12px', padding: '12px 14px', resize: 'vertical' }}
                  />
                </label>

                <label style={{ display: 'grid', gap: '10px' }}>
                  <span className="section-kicker" style={{ fontSize: '11px', letterSpacing: '0.12em' }}>Or upload local images</span>
                  <input
                    ref={panelImageInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={(event) => choosePanelImages(event.target.files, event.target)}
                    style={{ border: '1px dashed rgba(148, 163, 184, 0.4)', background: 'rgba(15, 23, 42, 0.6)', borderRadius: '12px', padding: '12px 14px', color: '#cbd5e1' }}
                  />
                  {selectedPanelImages.length > 0 && (
                    <span style={{ color: '#e2e8f0', fontSize: '13px' }}>
                      {selectedPanelImages.length} image{selectedPanelImages.length === 1 ? '' : 's'} selected
                      {selectedPanelImages.map((file) => (
                        <span key={`${file.name}-${file.lastModified}`} style={{ display: 'block', color: '#94a3b8' }}>
                          {file.name} · {formatFileSize(file.size)}
                        </span>
                      ))}
                    </span>
                  )}
                </label>

                <div className="upload-actions" style={{ marginTop: '0' }}>
                  <p><CircleHelp size={15} /> Add a direct Cloudinary link or select multiple local images for the portfolio gallery.</p>
                  <button type="submit" className="primary-button" disabled={(!panelImageUrl.trim() && !selectedPanelImages.length) || isSavingPanelImage || connection !== 'online'}>
                    {isSavingPanelImage ? <LoaderCircle className="spin" size={17} /> : <Upload size={16} />}
                    {isSavingPanelImage ? 'Saving images' : 'Add panel images'}
                  </button>
                </div>
              </form>
            </div>

            <aside className="training-aside">
              <div className="aside-icon"><Sparkles size={18} /></div>
              <span className="section-kicker">PORTFOLIO GALLERY</span>
              <h2>Show all family work images</h2>
              <p>These photos are stored on the same server and can be displayed in the family-work section of the main portfolio site.</p>
              <div className="aside-rule" />
              <div className="aside-foot"><span className="aside-number">01</span><span>Use a Cloudinary link or upload multiple local images.</span></div>
              <div className="aside-foot"><span className="aside-number">02</span><span>Each new photo becomes a portfolio gallery item.</span></div>
            </aside>
          </section>

          <section className="documents-section" aria-labelledby="documents-heading">
            <div className="documents-header">
              <div className="documents-title"><div className="section-title-row"><div><span className="section-kicker">YOUR LIBRARY</span><h2 id="documents-heading">Source documents <span className="count-pill">{documents.length}</span></h2></div></div><p>Reference files currently available to your assistant.</p></div>
              <div className="document-tools">
                <label className="search-field"><Search size={16} /><input type="search" placeholder="Find a document" value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} aria-label="Find a document" /></label>
                <button type="button" className="icon-button refresh-button" onClick={() => { setIsLoading(true); void refreshDocuments() }} disabled={isLoading} aria-label="Refresh documents" title="Refresh documents"><RefreshCw className={isLoading ? 'spin' : ''} size={16} /></button>
              </div>
            </div>

            <div className="documents-table-wrap">
              <table className="documents-table">
                <thead><tr><th scope="col">DOCUMENT</th><th scope="col">TYPE</th><th scope="col">ADDED</th><th scope="col" className="action-heading">ACTION</th></tr></thead>
                <tbody>
                  {isLoading ? (
                    <tr><td className="table-message" colSpan="4"><LoaderCircle className="spin" size={19} /> Loading documents</td></tr>
                  ) : filteredDocuments.length ? filteredDocuments.map((document) => {
                    const extension = document.filename.split('.').pop()?.toUpperCase() || 'FILE'
                    return (
                      <tr key={document.id}>
                        <td><div className="document-name"><span className="document-icon"><FileText size={18} /></span><strong title={document.filename}>{document.filename}</strong></div></td>
                        <td><span className={`type-label type-${extension.toLowerCase()}`}>{extension}</span></td>
                        <td className="date-cell">{formatDate(document.uploadedAt)}</td>
                        <td className="action-cell"><button type="button" className="icon-button delete-button" onClick={() => void handleDelete(document)} disabled={deletingId === document.id} aria-label={`Remove ${document.filename}`} title="Remove document">{deletingId === document.id ? <LoaderCircle className="spin" size={16} /> : <Trash2 size={16} />}</button></td>
                      </tr>
                    )
                  }) : (
                    <tr><td className="empty-cell" colSpan="4"><div className="empty-state"><span className="empty-icon">{searchTerm ? <Search size={20} /> : <Database size={20} />}</span><strong>{searchTerm ? 'No matching documents' : 'Your knowledge base is empty'}</strong><span>{searchTerm ? 'Try another filename.' : 'Upload a CV or project document to get started.'}</span></div></td></tr>
                  )}
                </tbody>
              </table>
            </div>

            <footer className="library-footer"><span><Check size={14} /> {documents.length} {documents.length === 1 ? 'document' : 'documents'} in your library</span><span>API <code>{API_BASE_URL}</code></span></footer>
          </section>

          <section className="documents-section" aria-labelledby="panel-images-heading" style={{ marginTop: '28px' }}>
            <div className="documents-header">
              <div className="documents-title">
                <div className="section-title-row">
                  <div>
                    <span className="section-kicker">GALLERY</span>
                    <h2 id="panel-images-heading">Portfolio image library <span className="count-pill">{panelImages.length}</span></h2>
                  </div>
                </div>
                <p>Photos available for display in the family-work section.</p>
              </div>
              <button type="button" className="icon-button refresh-button" onClick={() => { void refreshPanelImages() }} aria-label="Refresh panel images" title="Refresh panel images"><RefreshCw size={16} /></button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '18px', marginTop: '18px' }}>
              {panelImages.length ? panelImages.map((image) => (
                <div key={image.id} style={{ background: '#0f172a', border: '1px solid rgba(148, 163, 184, 0.2)', borderRadius: '16px', overflow: 'hidden' }}>
                  <img src={image.imageUrl} alt={image.alt || image.title} style={{ width: '100%', height: '180px', objectFit: 'cover', display: 'block' }} />
                  <div style={{ padding: '12px 14px', display: 'grid', gap: '6px' }}>
                    <strong style={{ color: '#f8fafc' }}>{image.title}</strong>
                    {image.description && <span style={{ color: '#cbd5e1', fontSize: '12px' }}>{image.description}</span>}
                    <button type="button" className="icon-button delete-button" onClick={() => void handleDeletePanelImage(image.id)} aria-label={`Remove ${image.title}`} title="Remove image" style={{ justifySelf: 'flex-end' }}><Trash2 size={15} /></button>
                  </div>
                </div>
              )) : (
                <div className="empty-cell" style={{ width: '100%' }}>
                  <div className="empty-state"><span className="empty-icon"><Database size={20} /></span><strong>No panel images yet</strong><span>Add a Cloudinary link or upload one below.</span></div>
                </div>
              )}
            </div>
          </section>
        </div>
      </main>
      <ChatTester connection={connection} />
    </div>
  )
}

export default App
