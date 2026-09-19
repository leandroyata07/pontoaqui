import React, { useState, useEffect, useRef } from 'react'
import { db } from '../db'
import { useNavigate, useParams } from '@tanstack/react-router'
import { Delete, Check, CheckCircle2, X, User, Coffee, LogOut, LogIn, Clock, AlertCircle, Info, Camera, Share2, FileText, Download, QrCode, Activity, ChevronRight, Bell, ShieldCheck, ShieldAlert, Mail, Calendar, MapPin, Scale, TrendingUp, TrendingDown, Sparkles, CheckSquare, Square, Layers, ListChecks, Copy, RotateCcw } from 'lucide-react'
import { format, startOfMonth, eachDayOfInterval, parseISO } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import html2canvas from 'html2canvas'
import { QRCodeSVG } from 'qrcode.react'
import { ThemeToggle } from './ThemeToggle'
import { toMinutes, checkEmployeeWorkDay, isNationalOrCustomHoliday } from '../utils/shiftUtils'
import { pushDocToFirestore } from '../firebase'
import { subscribeAutoPunchStatus } from '../services/autoPunchService'
import { calculateEmployeeMonthBalance } from '../utils/timeBankUtils'

const RECORD_TYPES = {
  check_in: { label: 'Entrada Principal', icon: LogIn, color: 'bg-emerald-500' },
  lunch_out: { label: 'Saída Refeição', icon: Coffee, color: 'bg-orange-500' },
  lunch_in: { label: 'Retorno Refeição', icon: Coffee, color: 'bg-blue-500' },
  check_out: { label: 'Saída Definitiva', icon: LogOut, color: 'bg-red-500' },
  other_out: { label: 'Saída Extra', icon: Clock, color: 'bg-purple-500', needsReason: true },
  other_in: { label: 'Retorno Extra', icon: Clock, color: 'bg-indigo-500' },
  system_auto_checkout: { label: 'Saída Automática', icon: LogOut, color: 'bg-red-500' },
  admin_excused: { label: 'Atestado Médico', icon: FileText, color: 'bg-emerald-500' },
  admin_abonada: { label: 'Falta Abonada', icon: CheckCircle2, color: 'bg-teal-500' },
  admin_vacation: { label: 'Férias', icon: Calendar, color: 'bg-cyan-500' },
  admin_absence: { label: 'Falta Injustificada', icon: AlertCircle, color: 'bg-rose-500' }
}

export function PinEntry() {
  const { employeeId } = useParams({ from: '/pin/$employeeId' })
  const navigate = useNavigate()
  const inputRef = useRef(null)
  const videoRef = useRef(null)
  const canvasRef = useRef(null)

  const [step, setStep] = useState('pin') // pin | select | success
  const [pin, setPin] = useState('')
  const [employee, setEmployee] = useState(null)
  const [error, setError] = useState(false)
  const [todayRecords, setTodayRecords] = useState([])
  const [selectedType, setSelectedType] = useState(null)
  const [reason, setReason] = useState('')
  const [recordedTime, setRecordedTime] = useState(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [settings, setSettings] = useState(null)
  const [redirectTimer, setRedirectTimer] = useState(null)
  const [historyRecords, setHistoryRecords] = useState([])
  const [selectedTickets, setSelectedTickets] = useState(null)
  const [showQR, setShowQR] = useState(false)
  const [extraCategory, setExtraCategory] = useState(null)
  const [startDate, setStartDate] = useState(format(startOfMonth(new Date()), 'yyyy-MM-dd'))
  const [endDate, setEndDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [isDemo, setIsDemo] = useState(false)
  const [simulateTime, setSimulateTime] = useState(false)
  const [customTime, setCustomTime] = useState(format(new Date(), 'HH:mm'))
  const [customDate, setCustomDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const ticketRef = useRef(null)

  // Notificações pessoais do colaborador (deferimentos / indeferimentos)
  const [employeeNotifications, setEmployeeNotifications] = useState([])
  const [showEmployeeNotifsModal, setShowEmployeeNotifsModal] = useState(false)

  // Ajuste de Ponto Esquecido no mesmo dia
  const [isForgottenOpen, setIsForgottenOpen] = useState(false)
  const [forgottenType, setForgottenType] = useState('check_in')
  const [forgottenTime, setForgottenTime] = useState(format(new Date(), 'HH:mm'))
  const [forgottenReason, setForgottenReason] = useState('')

  // Inclusão de Pontos de Dias Anteriores (quando autorizado)
  const [retroMode, setRetroMode] = useState('batch') // 'batch' | 'single'
  const [retroDayDate, setRetroDayDate] = useState('')
  const [retroDayType, setRetroDayType] = useState('check_in')
  const [retroDayTime, setRetroDayTime] = useState('08:00')
  const [retroDayReason, setRetroDayReason] = useState('')
  const [isSubmittingRetro, setIsSubmittingRetro] = useState(false)
  const [singleDayRecords, setSingleDayRecords] = useState([])

  // Modelo Padrão de Horários para o Período Completo (Lote)
  const [templateIn, setTemplateIn] = useState('08:00')
  const [templateLunchOut, setTemplateLunchOut] = useState('12:00')
  const [templateLunchIn, setTemplateLunchIn] = useState('13:00')
  const [templateOut, setTemplateOut] = useState('17:00')
  const [templateHasLunch, setTemplateHasLunch] = useState(true)

  // Lista de dias gerada no intervalo autorizado
  const [retroDaysList, setRetroDaysList] = useState([])
  const [retroBatchReason, setRetroBatchReason] = useState('')
  const [isSubmittingRetroBatch, setIsSubmittingRetroBatch] = useState(false)
  const [isLoadingRetroDays, setIsLoadingRetroDays] = useState(false)

  // Correção Manual de Dia Excluído (quando autorizada pelo gestor)
  const [correctionDate, setCorrectionDate] = useState('')
  const [correctionCheckIn, setCorrectionCheckIn] = useState('08:00')
  const [correctionHasLunch, setCorrectionHasLunch] = useState(true)
  const [correctionLunchOut, setCorrectionLunchOut] = useState('12:00')
  const [correctionLunchIn, setCorrectionLunchIn] = useState('13:00')
  const [correctionCheckOut, setCorrectionCheckOut] = useState('17:48')
  const [correctionReason, setCorrectionReason] = useState('')
  const [isSubmittingCorrection, setIsSubmittingCorrection] = useState(false)

  const handleOpenDayCorrection = (emp = employee) => {
    if (!emp?.dayCorrectionDate) return
    setCorrectionDate(emp.dayCorrectionDate)
    setCorrectionCheckIn(emp.shiftStart || '08:00')
    setCorrectionLunchOut(emp.lunchStart || '12:00')
    setCorrectionLunchIn(emp.lunchEnd || '13:00')
    setCorrectionCheckOut(emp.shiftEnd || '17:48')
    setCorrectionHasLunch(Boolean(emp.lunchStart && emp.lunchEnd))
    setCorrectionReason('')
    setStep('day_correction')
  }

  const handleSubmitDayCorrection = async (e) => {
    e.preventDefault()
    if (!correctionDate) {
      showFeedback({ type: 'warning', title: 'Data Inválida', message: 'Nenhuma data autorizada foi encontrada.' })
      return
    }
    if (!correctionCheckIn || !correctionCheckOut) {
      showFeedback({ type: 'warning', title: 'Horários Obrigatórios', message: 'Informe pelo menos os horários de Entrada e Saída.' })
      return
    }
    if (correctionHasLunch && (!correctionLunchOut || !correctionLunchIn)) {
      showFeedback({ type: 'warning', title: 'Horários do Almoço', message: 'Informe os horários de saída e retorno do almoço.' })
      return
    }

    setIsSubmittingCorrection(true)
    try {
      const punchesToCreate = [
        { type: 'check_in', time: correctionCheckIn, label: 'Entrada Principal' }
      ]
      if (correctionHasLunch) {
        punchesToCreate.push(
          { type: 'lunch_out', time: correctionLunchOut, label: 'Saída Refeição' },
          { type: 'lunch_in', time: correctionLunchIn, label: 'Retorno Refeição' }
        )
      }
      punchesToCreate.push(
        { type: 'check_out', time: correctionCheckOut, label: 'Saída Definitiva' }
      )

      const reasonText = correctionReason.trim() || 'Ajuste manual autorizado após exclusão pela gestão'
      const createdRecords = []

      for (const punch of punchesToCreate) {
        const recordDate = new Date(`${correctionDate}T${punch.time}:00`)
        const rec = {
          employeeId: Number(employeeId),
          employeeName: employee.name,
          employeeCpf: employee.cpf || '',
          timestamp: recordDate.toISOString(),
          systemTimestamp: new Date().toISOString(),
          type: punch.type,
          category: 'day_correction',
          status: 'pending',
          comment: `Correção de Dia Excluído: ${reasonText}`,
          declaredTime: punch.time
        }
        const recId = await db.records.add(rec)
        await pushDocToFirestore('records', recId, { ...rec, id: recId })
        createdRecords.push({ ...rec, id: recId })
      }

      // Notificação ao Administrador
      const adminNotif = {
        target: 'admin',
        type: 'day_correction',
        title: 'Correção de Dia Enviada',
        message: `${employee.name} enviou a correção manual dos pontos do dia ${format(new Date(correctionDate + 'T12:00:00'), 'dd/MM/yyyy')} (${createdRecords.length} batidas). Aguarda deferimento na Central de Aprovações.`,
        employeeId: Number(employeeId),
        timestamp: new Date().toISOString(),
        read: false
      }
      const notifId = await db.notifications.add(adminNotif)
      await pushDocToFirestore('notifications', notifId, { ...adminNotif, id: notifId })

      showFeedback({
        type: 'success',
        title: 'Correção Enviada com Sucesso!',
        message: `As ${createdRecords.length} batidas do dia ${format(new Date(correctionDate + 'T12:00:00'), 'dd/MM/yyyy')} foram enviadas para aprovação do Administrador. Assim que deferidas, a função será automaticamente encerrada.`,
        onConfirm: () => {
          loadTodayRecords()
          setStep('select')
        }
      })
    } catch (err) {
      console.error('Erro ao submeter correção do dia:', err)
      showFeedback({
        type: 'error',
        title: 'Erro no Envio',
        message: 'Ocorreu um erro ao registrar as batidas da correção. Tente novamente.'
      })
    } finally {
      setIsSubmittingCorrection(false)
    }
  }

  const initRetroDays = async (emp = employee) => {
    if (!emp?.retroactiveStart || !emp?.retroactiveEnd) return
    setIsLoadingRetroDays(true)
    try {
      const start = parseISO(emp.retroactiveStart)
      const end = parseISO(emp.retroactiveEnd)
      if (start > end) return

      const days = eachDayOfInterval({ start, end })

      // Carrega feriados cadastrados no sistema
      const holidays = await db.holidays.toArray()

      // Carrega registros existentes no período para não gerar pontos duplicados
      const existingRecords = await db.records
        .where('employeeId')
        .equals(Number(emp.id))
        .toArray()

      const sIn = emp.shiftStart || '08:00'
      const sLunchOut = emp.lunchStart || '12:00'
      const sLunchIn = emp.lunchEnd || '13:00'
      const sOut = emp.shiftEnd || '17:00'

      setTemplateIn(sIn)
      setTemplateLunchOut(sLunchOut)
      setTemplateLunchIn(sLunchIn)
      setTemplateOut(sOut)

      const list = days.map(d => {
        const dateStr = format(d, 'yyyy-MM-dd')
        const holiday = isNationalOrCustomHoliday(dateStr, holidays)
        const dayWork = checkEmployeeWorkDay(emp, d)
        const dayName = format(d, 'EEEE', { locale: ptBR })
        const shortDate = format(d, 'dd/MM')

        // Verifica quantos registros já existem nesta data (excluindo rejeitados)
        const existingOnDay = existingRecords.filter(r => {
          const rDateStr = format(new Date(r.timestamp), 'yyyy-MM-dd')
          return rDateStr === dateStr && r.status !== 'rejected'
        })
        existingOnDay.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))

        const existingSummary = existingOnDay
          .map(r => `${RECORD_TYPES[r.type]?.label || r.type} (${format(new Date(r.timestamp), 'HH:mm')})`)
          .join(', ')

        // Se for feriado: por padrão NÃO é dia de trabalho padrão e NÃO vem selecionado,
        // mas o colaborador PODE selecionar e lançar caso tenha trabalhado em feriado.
        const isScheduledWorkDay = dayWork.isWorkDay && !holiday
        const isAutoSelected = isScheduledWorkDay && existingOnDay.length === 0

        const workDayLabel = holiday
          ? `Feriado: ${holiday.name}`
          : (dayWork.label || (dayWork.isWorkDay ? 'Dia Útil' : 'Folga'))

        return {
          dateStr,
          dateObj: d,
          dayName: dayName.charAt(0).toUpperCase() + dayName.slice(1),
          shortDate,
          fullDateDisplay: format(d, 'dd/MM/yyyy'),
          isWorkDay: isScheduledWorkDay,
          isHoliday: !!holiday,
          holidayName: holiday?.name || '',
          workDayLabel,
          existingCount: existingOnDay.length,
          existingSummary,
          selected: isAutoSelected,
          hasLunch: true,
          checkIn: sIn,
          lunchOut: sLunchOut,
          lunchIn: sLunchIn,
          checkOut: sOut
        }
      })

      setRetroDaysList(list)
    } catch (err) {
      console.error('Erro ao inicializar dias retroativos:', err)
    } finally {
      setIsLoadingRetroDays(false)
    }
  }

  const handleApplyTemplateToAll = () => {
    setRetroDaysList(prev => prev.map(day => ({
      ...day,
      checkIn: templateIn,
      lunchOut: templateLunchOut,
      lunchIn: templateLunchIn,
      checkOut: templateOut,
      hasLunch: templateHasLunch
    })))
  }

  const handleToggleDay = (dateStr) => {
    setRetroDaysList(prev => prev.map(d => d.dateStr === dateStr ? { ...d, selected: !d.selected } : d))
  }

  const handleUpdateDayField = (dateStr, field, value) => {
    setRetroDaysList(prev => prev.map(d => d.dateStr === dateStr ? { ...d, [field]: value } : d))
  }

  const handleSelectAllWorkDays = () => {
    setRetroDaysList(prev => prev.map(d => ({ ...d, selected: d.isWorkDay && !d.isHoliday })))
  }

  const handleSelectAllDays = () => {
    setRetroDaysList(prev => prev.map(d => ({ ...d, selected: true })))
  }

  const handleDeselectAll = () => {
    setRetroDaysList(prev => prev.map(d => ({ ...d, selected: false })))
  }

  // Telemetria de Auto-Ponto por Geofencing (GPS)
  const [autoPunchTelemetry, setAutoPunchTelemetry] = useState(null)

  // Saldo de Banco de Horas em Tempo Real
  const [timeBank, setTimeBank] = useState(null)

  // Popup / Modal de Feedback do Sistema (substitui alerts nativos do navegador)
  const [feedbackModal, setFeedbackModal] = useState(null)

  const showFeedback = ({ type = 'info', title, message, onConfirm }) => {
    setFeedbackModal({ type, title, message, onConfirm })
  }

  useEffect(() => {
    const unsub = subscribeAutoPunchStatus((data) => {
      if (data && employeeId && String(data.employeeId) === String(employeeId)) {
        setAutoPunchTelemetry(data)
      }
    })
    return () => unsub()
  }, [employeeId])

  const loadEmployeeNotifications = async (empId = employeeId) => {
    if (!empId) return
    try {
      const notifs = await db.notifications
        .where('employeeId')
        .equals(Number(empId))
        .toArray()
      const empNotifs = notifs.filter(n => n.target === 'employee' || ['request_approved', 'request_rejected'].includes(n.type))
      empNotifs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      setEmployeeNotifications(empNotifs)
    } catch (err) {
      console.warn('Erro ao carregar notificações do colaborador:', err)
    }
  }

  const loadTimeBank = async (empId = employeeId, empObj = null) => {
    if (!empId) return
    try {
      const emp = empObj || employee || await db.employees.get(Number(empId))
      if (!emp) return
      const now = new Date()
      const mStart = startOfMonth(now)
      const holidays = await db.holidays.toArray()
      const records = await db.records
        .where('employeeId')
        .equals(Number(emp.id))
        .filter(r => new Date(r.timestamp) >= mStart)
        .toArray()
      const balance = calculateEmployeeMonthBalance(emp, records, holidays, format(now, 'yyyy-MM'))
      setTimeBank(balance)
    } catch (err) {
      console.warn('Erro ao carregar banco de horas do colaborador:', err)
    }
  }

  // Efeito inteligente: inspeciona batidas do dia avulso selecionado
  useEffect(() => {
    let isMounted = true
    const checkSingleDay = async () => {
      if (!retroDayDate || !employeeId) {
        setSingleDayRecords([])
        return
      }
      try {
        const records = await db.records
          .where('employeeId')
          .equals(Number(employeeId))
          .toArray()
        const dayPunches = records.filter(r => {
          if (r.status === 'rejected') return false
          const dStr = format(new Date(r.timestamp), 'yyyy-MM-dd')
          return dStr === retroDayDate
        })
        dayPunches.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))

        if (isMounted) {
          setSingleDayRecords(dayPunches)
          
          // Se o dia já tem entrada e saída principal (jornada padrão preenchida),
          // direciona automaticamente para Saída Extra para evitar duplicidade
          const hasCheckIn = dayPunches.some(r => r.type === 'check_in')
          const hasCheckOut = dayPunches.some(r => r.type === 'check_out')
          if (hasCheckIn && hasCheckOut) {
            setRetroDayType(prev => (prev === 'other_in' || prev === 'other_out' ? prev : 'other_out'))
          }
        }
      } catch (err) {
        console.error('Erro ao verificar batidas do dia avulso:', err)
      }
    }
    checkSingleDay()
    return () => { isMounted = false }
  }, [retroDayDate, employeeId, step, retroMode])

  useEffect(() => {
    db.settings.get('config').then(setSettings)
    db.employees.get(Number(employeeId)).then(emp => {
      setEmployee(emp)
      if (emp?.cpf === '000.000.000-00') setIsDemo(true)
      if (emp?.allowRetroactive && emp?.retroactiveStart) {
        setRetroDayDate(emp.retroactiveStart)
        if (emp?.retroactiveEnd) {
          initRetroDays(emp)
        }
      }
      if (sessionStorage.getItem('biometricVerified') === String(employeeId)) {
        sessionStorage.removeItem('biometricVerified')
        setStep('select')
      }
      loadTimeBank(employeeId, emp)
    })
    loadTodayRecords()
    loadEmployeeNotifications()

    const handleSync = () => {
      loadTodayRecords()
      loadEmployeeNotifications()
      loadTimeBank()
    }
    window.addEventListener('pontoaqui:sync', handleSync)
    return () => {
      window.removeEventListener('pontoaqui:sync', handleSync)
    }
  }, [employeeId])

  useEffect(() => {
    if (step === 'pin') {
      const focusInput = () => {
        if (inputRef.current) inputRef.current.focus()
      }
      focusInput()
      const timer = setTimeout(focusInput, 100)
      window.addEventListener('focus', focusInput)
      return () => {
        clearTimeout(timer)
        window.removeEventListener('focus', focusInput)
      }
    }
  }, [step])

  useEffect(() => {
    if (step === 'camera') {
      startCamera()
    } else {
      stopCamera()
    }
    return () => stopCamera()
  }, [step])

  useEffect(() => {
    if (step === 'success') {
      const timer = setTimeout(() => {
        navigate({ to: '/' })
      }, 8000)
      setRedirectTimer(timer)
      return () => clearTimeout(timer)
    }
  }, [step, navigate])

  const handleShareReceipt = async () => {
    if (redirectTimer) clearTimeout(redirectTimer)

    const text = `*COMPROVANTE DE PONTO*\n\n🏢 *Empresa:* ${settings?.companyName || 'Empresa'}\n👤 *Funcionário:* ${employee.name}\n📅 *Data:* ${format(recordedTime, 'dd/MM/yyyy')}\n⏰ *Hora do Registro:* ${format(recordedTime, 'HH:mm')}${extraCategory === 'esquecimento' ? `\n🕒 *Chegada Declarada:* ${forgottenTime} (Em análise pelo Administrador)` : ''}\n📝 *Registro:* ${RECORD_TYPES[selectedType].label}\n🔑 *Autenticação:* ${recordedTime.getTime().toString(16).toUpperCase()}`

    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Comprovante de Ponto',
          text: text,
        })
      } catch (err) {
        console.error('Error sharing', err)
      }
    } else {
      await navigator.clipboard.writeText(text)
      showFeedback({
        type: 'success',
        title: 'Comprovante Copiado',
        message: 'Comprovante copiado para a área de transferência! Você pode colar no WhatsApp ou bloco de notas.'
      })
    }
  }

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } })
      if (videoRef.current) {
        videoRef.current.srcObject = stream
      }
    } catch (err) {
      console.error('Camera failed:', err)
      // If camera fails or is denied, skip the selfie step
      saveFinalRecord(null)
    }
  }

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      videoRef.current.srcObject.getTracks().forEach(track => track.stop())
    }
  }

  const capturePhoto = () => {
    if (videoRef.current && canvasRef.current) {
      const context = canvasRef.current.getContext('2d')
      canvasRef.current.width = 320
      canvasRef.current.height = 320
      const video = videoRef.current
      const size = Math.min(video.videoWidth, video.videoHeight)
      const x = (video.videoWidth - size) / 2
      const y = (video.videoHeight - size) / 2
      context.drawImage(video, x, y, size, size, 0, 0, 320, 320)
      const photoData = canvasRef.current.toDataURL('image/jpeg', 0.6)
      saveFinalRecord(photoData)
    }
  }

  const loadTodayRecords = async () => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const records = await db.records
      .where('employeeId')
      .equals(Number(employeeId))
      .filter(r => new Date(r.timestamp) >= today)
      .toArray()
    setTodayRecords(records.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp)))
  }

  const loadHistoryRecords = async () => {
    const records = await db.records
      .where('employeeId')
      .equals(Number(employeeId))
      .reverse()
      .limit(30)
      .toArray()
    setHistoryRecords(records)
  }

  const handleGenerateExtract = async () => {
    const [startYear, startMonth, startDay] = startDate.split('-').map(Number)
    const start = new Date(startYear, startMonth - 1, startDay, 0, 0, 0, 0)

    const [endYear, endMonth, endDay] = endDate.split('-').map(Number)
    const end = new Date(endYear, endMonth - 1, endDay, 23, 59, 59, 999)

    const records = await db.records
      .where('employeeId')
      .equals(Number(employeeId))
      .filter(r => {
        const d = new Date(r.timestamp)
        return d >= start && d <= end
      })
      .toArray()

    if (records.length === 0) {
      showFeedback({
        type: 'info',
        title: 'Sem Registros',
        message: 'Nenhum registro de ponto foi encontrado para o período selecionado.'
      })
      return
    }

    setSelectedTickets(records.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp)))
    setShowQR(false)
    setStep('ticket')
  }

  const calculateTotalHours = (records) => {
    if (!records || records.length < 2) return '00:00'
    let totalMs = 0
    let start = null

    const sorted = [...records].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))

    sorted.forEach(r => {
      const isEntry = ['check_in', 'lunch_in', 'other_in'].includes(r.type)
      const isExit = ['check_out', 'lunch_out', 'other_out'].includes(r.type)

      if (isEntry) {
        if (!start) start = new Date(r.timestamp)
      } else if (isExit && start) {
        const isWorkingAbsence = r.type === 'other_out' && (r.category === 'servico' || (r.category === 'medico' && r.status !== 'rejected'))
        if (!isWorkingAbsence) {
          totalMs += new Date(r.timestamp) - start
          start = null
        }
      }
    })

    const hours = Math.floor(totalMs / 3600000)
    const minutes = Math.floor((totalMs % 3600000) / 60000)
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}h`
  }

  const downloadTicketPNG = async () => {
    if (ticketRef.current) {
      try {
        // Ensure element is fully visible before capture
        const element = ticketRef.current
        const canvas = await html2canvas(element, {
          backgroundColor: '#fef3c7',
          scale: 3,
          useCORS: true,
          allowTaint: true,
          logging: false,
          windowHeight: element.scrollHeight + 100
        })
        const link = document.createElement('a')
        link.download = `Comprovante_PontoAqui_${selectedTickets && selectedTickets.length === 1 ? new Date(selectedTickets[0].timestamp).getTime().toString(16).toUpperCase() : 'extrato'}.png`
        link.href = canvas.toDataURL('image/png')
        link.click()
      } catch (err) {
        console.error('Failed to capture ticket', err)
        showFeedback({
          type: 'error',
          title: 'Erro ao Baixar',
          message: 'Não foi possível gerar a imagem do comprovante. Tente novamente.'
        })
      }
    }
  }

  const sendEmail = () => {
    const isSingle = selectedTickets.length === 1
    const subject = isSingle ? `Comprovante de Ponto - ${employee.name}` : `Extrato de Ponto - ${employee.name}`

    let body = ''
    if (isSingle) {
      const t = selectedTickets[0]
      const isRejected = t.status === 'rejected'
      body = (isRejected ? `[SOLICITAÇÃO INDEFERIDA - NÃO VÁLIDA COMO PONTO OFICIAL]\nMotivo: ${t.rejectionReason || 'Recusado pela gestão'}\nFavor procurar o setor de Recursos Humanos (RH).\n\n` : '') +
        `COMPROVANTE DE PONTO\n\n` +
        `Empresa: ${settings?.companyName || 'Empresa'}\n` +
        `Funcionário: ${employee.name}\n` +
        `Data: ${format(new Date(t.timestamp), 'dd/MM/yyyy')}\n` +
        `Hora: ${format(new Date(t.timestamp), 'HH:mm')}\n` +
        `Registro: ${RECORD_TYPES[t.type]?.label}\n` +
        (isRejected ? `Status: INDEFERIDO (RECUSADO)\n` : '') +
        `Chave: ${new Date(t.timestamp).getTime().toString(16).toUpperCase()}`
    } else {
      body = `EXTRATO DE PONTO\n\n` +
        `Empresa: ${settings?.companyName || 'Empresa'}\n` +
        `Funcionário: ${employee.name}\n` +
        `Período: ${format(new Date(startDate), 'dd/MM')} a ${format(new Date(endDate), 'dd/MM')}\n` +
        `Total Trabalhado: ${calculateTotalHours(selectedTickets)}\n\n` +
        `Registros:\n` +
        selectedTickets.map(t => `• ${format(new Date(t.timestamp), 'dd/MM HH:mm')} - ${RECORD_TYPES[t.type]?.label}`).join('\n')
    }

    const mailtoUrl = `mailto:${employee.email || ''}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
    window.location.href = mailtoUrl
  }

  const handleContainerClick = () => {
    if (step === 'pin') inputRef.current?.focus()
  }

  const handleInputChange = (e) => {
    const val = e.target.value.replace(/\D/g, '').slice(0, 4)
    setPin(val)
    if (error) setError(false)
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && pin.length === 4) {
      handlePinSubmit()
    }
  }

  const handleNumber = (num) => {
    if (pin.length < 4) {
      setPin(pin + num)
      setError(false)
    }
  }

  const handleDelete = () => {
    setPin(pin.slice(0, -1))
  }

  const handlePinSubmit = () => {
    if (pin === employee.pin) {
      setStep('select')
    } else {
      setError(true)
      setPin('')
    }
  }

  const handleStartForgottenRecord = () => {
    if (!forgottenTime) {
      showFeedback({
        type: 'warning',
        title: 'Horário Obrigatório',
        message: 'Por favor, informe o horário em que você realmente chegou.'
      })
      return
    }
    setSelectedType(forgottenType)
    setExtraCategory('esquecimento')
    setReason(forgottenReason)
    setIsForgottenOpen(false)
    setStep('camera')
  }

  const handleSaveRetroDay = async (e) => {
    e.preventDefault()
    if (!retroDayDate || !retroDayTime) {
      showFeedback({
        type: 'warning',
        title: 'Campos Obrigatórios',
        message: 'Por favor, informe a data e o horário do ponto.'
      })
      return
    }
    if (employee?.retroactiveStart && retroDayDate < employee.retroactiveStart) {
      showFeedback({
        type: 'warning',
        title: 'Data Inválida',
        message: `A data não pode ser anterior ao início autorizado (${format(new Date(employee.retroactiveStart + 'T12:00:00'), 'dd/MM/yyyy')}).`
      })
      return
    }
    if (employee?.retroactiveEnd && retroDayDate > employee.retroactiveEnd) {
      showFeedback({
        type: 'warning',
        title: 'Data Inválida',
        message: `A data não pode ser posterior ao fim autorizado (${format(new Date(employee.retroactiveEnd + 'T12:00:00'), 'dd/MM/yyyy')}).`
      })
      return
    }

    setIsSubmittingRetro(true)
    try {
      const [year, month, day] = retroDayDate.split('-').map(Number)
      const [hour, minute] = retroDayTime.split(':').map(Number)
      const targetDateTime = new Date(year, month - 1, day, hour, minute, 0, 0)

      // VALIDAÇÃO ANTI-DUPLICIDADE: Verifica se já existe batida nesta data para o colaborador
      const existingEmpRecords = await db.records
        .where('employeeId')
        .equals(Number(employee.id))
        .toArray()

      const nonRejected = existingEmpRecords.filter(r => {
        if (r.status === 'rejected') return false
        const recDate = format(new Date(r.timestamp), 'yyyy-MM-dd')
        return recDate === retroDayDate
      })

      // 1. Bloqueio por Horário Idêntico (mesmo minuto)
      const exactTimeMatch = nonRejected.find(r => {
        const recTime = format(new Date(r.timestamp), 'HH:mm')
        return recTime === retroDayTime
      })

      if (exactTimeMatch) {
        const typeLabel = RECORD_TYPES[exactTimeMatch.type]?.label || exactTimeMatch.type
        const isPending = exactTimeMatch.status === 'pending'
        showFeedback({
          type: 'warning',
          title: 'Ponto Já Registrado',
          message: `Já existe uma marcação de "${typeLabel}" ${isPending ? 'pendente de aprovação' : 'já registrada'} exatamente às ${retroDayTime} no dia ${format(new Date(retroDayDate + 'T12:00:00'), 'dd/MM/yyyy')}. Para evitar duplicidade na folha, ajuste o horário ou consulte seu extrato.`
        })
        setIsSubmittingRetro(false)
        return
      }

      // 2. Bloqueio por Tipo Principal Duplicado no mesmo dia (check_in, lunch_out, lunch_in, check_out)
      const primaryPunchTypes = ['check_in', 'lunch_out', 'lunch_in', 'check_out']
      if (primaryPunchTypes.includes(retroDayType)) {
        const sameTypeMatch = nonRejected.find(r => r.type === retroDayType)
        if (sameTypeMatch) {
          const recTime = format(new Date(sameTypeMatch.timestamp), 'HH:mm')
          const isPending = sameTypeMatch.status === 'pending'
          const typeLabel = RECORD_TYPES[retroDayType]?.label || retroDayType
          showFeedback({
            type: 'warning',
            title: 'Marcação Duplicada',
            message: `O dia ${format(new Date(retroDayDate + 'T12:00:00'), 'dd/MM/yyyy')} já possui uma "${typeLabel}" ${isPending ? 'pendente de aprovação' : 'registrada'} às ${recTime}. Não é permitido lançar duas vezes o mesmo tipo de marcação no mesmo dia. Se precisar lançar horários extras, utilize as opções "Retorno Extra" ou "Saída Extra".`
          })
          setIsSubmittingRetro(false)
          return
        }
      }

      const commentText = retroDayReason?.trim() ? `Lançamento Retroativo Autorizado (${retroDayReason.trim()})` : 'Lançamento Retroativo Autorizado'

      const recId = await db.records.add({
        employeeId: employee.id,
        timestamp: targetDateTime.toISOString(),
        systemTimestamp: new Date().toISOString(),
        type: retroDayType,
        comment: commentText,
        category: 'retroactive_day',
        status: 'pending'
      })

      await pushDocToFirestore('records', recId, {
        id: recId,
        employeeId: employee.id,
        timestamp: targetDateTime.toISOString(),
        systemTimestamp: new Date().toISOString(),
        type: retroDayType,
        comment: commentText,
        category: 'retroactive_day',
        status: 'pending'
      })

      const notifId = await db.notifications.add({
        target: 'admin',
        type: 'retroactive',
        message: `${employee.name} lançou ponto retroativo para ${format(targetDateTime, 'dd/MM/yyyy')} às ${retroDayTime} (${RECORD_TYPES[retroDayType]?.label || retroDayType}). Aguarda deferimento.`,
        timestamp: new Date().toISOString(),
        read: false,
        employeeId: employee.id
      })

      await pushDocToFirestore('notifications', notifId, {
        id: notifId,
        target: 'admin',
        type: 'retroactive',
        message: `${employee.name} lançou ponto retroativo para ${format(targetDateTime, 'dd/MM/yyyy')} às ${retroDayTime} (${RECORD_TYPES[retroDayType]?.label || retroDayType}). Aguarda deferimento.`,
        timestamp: new Date().toISOString(),
        read: false,
        employeeId: employee.id
      })

      loadTimeBank()
      loadTodayRecords()

      showFeedback({
        type: 'success',
        title: 'Ponto Enviado com Sucesso',
        message: 'Ponto retroativo enviado com sucesso para a aprovação do Administrador!',
        onConfirm: () => {
          setRetroDayReason('')
          setStep('select')
        }
      })
    } catch (err) {
      console.error(err)
      showFeedback({
        type: 'error',
        title: 'Erro de Envio',
        message: 'Ocorreu um erro ao enviar o ponto retroativo. Tente novamente.'
      })
    } finally {
      setIsSubmittingRetro(false)
    }
  }

  const handleSaveRetroBatch = async (e) => {
    if (e) e.preventDefault()
    const selectedDays = retroDaysList.filter(d => d.selected)
    if (selectedDays.length === 0) {
      showFeedback({
        type: 'warning',
        title: 'Nenhum Dia Selecionado',
        message: 'Por favor, selecione ao menos um dia no período para realizar o lançamento.'
      })
      return
    }

    setIsSubmittingRetroBatch(true)
    try {
      // Carrega registros existentes no banco para filtrar e prevenir duplicatas
      const allEmpRecords = await db.records
        .where('employeeId')
        .equals(Number(employee.id))
        .toArray()

      const nonRejected = allEmpRecords.filter(r => r.status !== 'rejected')
      const primaryPunchTypes = ['check_in', 'lunch_out', 'lunch_in', 'check_out']

      const punchesToCreate = []
      let skippedDuplicateCount = 0

      for (const day of selectedDays) {
        const [year, month, dayNum] = day.dateStr.split('-').map(Number)
        const candidates = []

        // 1. Entrada Principal
        if (day.checkIn) {
          const [h, m] = day.checkIn.split(':').map(Number)
          candidates.push({
            type: 'check_in',
            time: day.checkIn,
            dt: new Date(year, month - 1, dayNum, h, m, 0, 0)
          })
        }

        // 2. Almoço (se habilitado para este dia)
        if (day.hasLunch) {
          if (day.lunchOut) {
            const [h, m] = day.lunchOut.split(':').map(Number)
            candidates.push({
              type: 'lunch_out',
              time: day.lunchOut,
              dt: new Date(year, month - 1, dayNum, h, m, 0, 0)
            })
          }
          if (day.lunchIn) {
            const [h, m] = day.lunchIn.split(':').map(Number)
            candidates.push({
              type: 'lunch_in',
              time: day.lunchIn,
              dt: new Date(year, month - 1, dayNum, h, m, 0, 0)
            })
          }
        }

        // 3. Saída Definitiva
        if (day.checkOut) {
          const [h, m] = day.checkOut.split(':').map(Number)
          candidates.push({
            type: 'check_out',
            time: day.checkOut,
            dt: new Date(year, month - 1, dayNum, h, m, 0, 0)
          })
        }

        // Filtra contra batidas já existentes no mesmo dia
        for (const cand of candidates) {
          const isDuplicate = nonRejected.some(existing => {
            const recDate = format(new Date(existing.timestamp), 'yyyy-MM-dd')
            if (recDate !== day.dateStr) return false
            const recTime = format(new Date(existing.timestamp), 'HH:mm')
            return recTime === cand.time || (primaryPunchTypes.includes(cand.type) && existing.type === cand.type)
          })

          if (isDuplicate) {
            skippedDuplicateCount++
          } else {
            punchesToCreate.push({
              type: cand.type,
              timestamp: cand.dt.toISOString(),
              dateDisplay: day.fullDateDisplay,
              timeDisplay: cand.time
            })
          }
        }
      }

      if (punchesToCreate.length === 0) {
        if (skippedDuplicateCount > 0) {
          showFeedback({
            type: 'warning',
            title: 'Batidas Já Existentes',
            message: 'Todas as batidas configuradas para os dias selecionados já constam como registradas ou pendentes de aprovação no sistema. Nenhuma solicitação duplicada foi gerada.'
          })
        } else {
          showFeedback({
            type: 'warning',
            title: 'Horários Ausentes',
            message: 'Informe os horários dos dias selecionados para continuar.'
          })
        }
        setIsSubmittingRetroBatch(false)
        return
      }

      const nowIso = new Date().toISOString()
      const reasonText = retroBatchReason.trim() 
        ? `Lançamento Retroativo Autorizado (${retroBatchReason.trim()})` 
        : 'Lançamento Retroativo Autorizado'

      // Salva cada batida no Dexie e envia ao Firestore
      for (const p of punchesToCreate) {
        const recordData = {
          employeeId: employee.id,
          timestamp: p.timestamp,
          systemTimestamp: nowIso,
          type: p.type,
          comment: reasonText,
          category: 'retroactive_day',
          status: 'pending'
        }
        const recId = await db.records.add(recordData)
        await pushDocToFirestore('records', recId, { ...recordData, id: recId })
      }

      // Envia uma única notificação consolidada ao Admin
      const notifData = {
        target: 'admin',
        type: 'retroactive',
        message: `${employee.name} lançou preenchimento retroativo em lote para ${selectedDays.length} dia(s) (${punchesToCreate.length} batidas novas) de ${format(new Date(employee.retroactiveStart + 'T12:00:00'), 'dd/MM/yyyy')} a ${format(new Date(employee.retroactiveEnd + 'T12:00:00'), 'dd/MM/yyyy')}. Aguarda deferimento.`,
        timestamp: nowIso,
        read: false,
        employeeId: employee.id
      }
      const notifId = await db.notifications.add(notifData)
      await pushDocToFirestore('notifications', notifId, { ...notifData, id: notifId })

      loadTimeBank()
      loadTodayRecords()

      showFeedback({
        type: 'success',
        title: 'Período Enviado com Sucesso',
        message: `${punchesToCreate.length} nova(s) marcação(ões) de ponto enviada(s) para aprovação do Administrador!${skippedDuplicateCount > 0 ? ` (${skippedDuplicateCount} batida(s) foram ignoradas automaticamente pois já estavam registradas no sistema).` : ''}`,
        onConfirm: () => {
          setRetroBatchReason('')
          setStep('select')
        }
      })
    } catch (err) {
      console.error('Erro ao enviar lote retroativo:', err)
      showFeedback({
        type: 'error',
        title: 'Erro de Envio',
        message: 'Ocorreu um erro ao enviar os pontos retroativos em lote. Tente novamente.'
      })
    } finally {
      setIsSubmittingRetroBatch(false)
    }
  }

  const handleRecord = async (type, category = null) => {
    if (isProcessing) return
    if (RECORD_TYPES[type].needsReason && !category) {
      setSelectedType(type)
      return
    }

    if (category) {
      setExtraCategory(category)
    }

    const now = simulateTime ? new Date(`${customDate}T${customTime}:00`) : new Date()

    // Safety check: Prevent duplicate records within 1 minute
    if (todayRecords.length > 0) {
      const lastRecord = todayRecords[todayRecords.length - 1]
      const diffMs = now - new Date(lastRecord.timestamp)
      if (diffMs < 60000) {
        alert('Aguarde pelo menos 1 minuto entre registros de ponto.')
        return
      }
    }

    // Bulletproof validation before saving
    if (isTypeDisabled(type)) {
      alert('Este registro não é permitido no momento de acordo com a sequência lógica do ponto.')
      return
    }

    setSelectedType(type)
    setStep('camera')
  }

  const saveFinalRecord = async (photoData) => {
    // Wi-Fi Geofence Check (Simulated for Web)
    if (settings?.wifiGeofenceEnabled && settings.allowedSSID) {
      const isCorrectWifi = confirm(`O sistema está configurado para permitir ponto apenas na rede "${settings.allowedSSID}". Você está conectado a esta rede?`)
      if (!isCorrectWifi) {
        alert('Registro negado: Você deve estar conectado ao Wi-Fi da empresa.')
        return
      }
    }

    setIsProcessing(true)
    const now = simulateTime ? new Date(`${customDate}T${customTime}:00`) : new Date()

    const saveRecord = async (locationData = null) => {
      const isForgotten = extraCategory === 'esquecimento'
      const recordData = {
        employeeId: employee.id,
        timestamp: now.toISOString(),
        systemTimestamp: now.toISOString(),
        declaredTime: isForgotten ? forgottenTime : null,
        type: selectedType,
        comment: isForgotten
          ? `Ajuste por Esquecimento (Chegada Declarada: ${forgottenTime}) - ${reason || 'Sem observações'}`
          : extraCategory ? { medico: 'Médico', pessoal: 'Pessoal', servico: 'A Serviço' }[extraCategory] : '',
        category: extraCategory,
        status: (extraCategory === 'medico' || isForgotten) ? 'pending' : 'auto'
      }
      if (locationData) recordData.location = locationData
      if (photoData) recordData.photo = photoData

      const recId = await db.records.add(recordData)
      await pushDocToFirestore('records', recId, { ...recordData, id: recId })

      // Create Admin Notifications
      if (isForgotten) {
        const notifId = await db.notifications.add({
          target: 'admin',
          type: 'esquecimento',
          message: `${employee.name} registrou ponto com declaração de esquecimento: informou chegada às ${forgottenTime} (registrado às ${format(now, 'HH:mm')}).`,
          timestamp: new Date().toISOString(),
          read: false,
          employeeId: employee.id
        })
        await pushDocToFirestore('notifications', notifId, {
          id: notifId,
          target: 'admin',
          type: 'esquecimento',
          message: `${employee.name} registrou ponto com declaração de esquecimento: informou chegada às ${forgottenTime} (registrado às ${format(now, 'HH:mm')}).`,
          timestamp: new Date().toISOString(),
          read: false,
          employeeId: employee.id
        })
      } else if (extraCategory === 'medico') {
        const notifId = await db.notifications.add({
          target: 'admin',
          type: 'medical',
          message: `${employee.name} registrou uma saída para o médico e anexou um comprovante/foto.`,
          timestamp: new Date().toISOString(),
          read: false,
          employeeId: employee.id
        })
        await pushDocToFirestore('notifications', notifId, {
          id: notifId,
          target: 'admin',
          type: 'medical',
          message: `${employee.name} registrou uma saída para o médico e anexou um comprovante/foto.`,
          timestamp: new Date().toISOString(),
          read: false,
          employeeId: employee.id
        })
      }

      // Late Check-in Notification
      if (selectedType === 'check_in' && employee.shiftStart && !isForgotten) {
        const [h, m] = employee.shiftStart.split(':').map(Number)
        const shiftStart = new Date(now)
        shiftStart.setHours(h, m, 0, 0)

        if (now > shiftStart) {
          const diffMin = Math.round((now - shiftStart) / 60000)
          const tolerance = employee.toleranceMin ?? 10
          if (diffMin > tolerance) { // Tolerância da CLT (Art. 58, § 1º)
            const notifId = await db.notifications.add({
              target: 'admin',
              type: 'late',
              message: `${employee.name} chegou com ${diffMin} minutos de atraso (Turno: ${employee.shiftStart}, Tolerância CLT: ${tolerance} min).`,
              timestamp: new Date().toISOString(),
              read: false,
              employeeId: employee.id
            })
            await pushDocToFirestore('notifications', notifId, {
              id: notifId,
              target: 'admin',
              type: 'late',
              message: `${employee.name} chegou com ${diffMin} minutos de atraso (Turno: ${employee.shiftStart}, Tolerância CLT: ${tolerance} min).`,
              timestamp: new Date().toISOString(),
              read: false,
              employeeId: employee.id
            })
          }
        }
      }

      setRecordedTime(now)
      setStep('success')
      setIsProcessing(false)
    }

    const getDistance = (lat1, lon1, lat2, lon2) => {
      const R = 6371e3;
      const f1 = lat1 * Math.PI / 180;
      const f2 = lat2 * Math.PI / 180;
      const df = (lat2 - lat1) * Math.PI / 180;
      const dl = (lon2 - lon1) * Math.PI / 180;
      const a = Math.sin(df / 2) * Math.sin(df / 2) + Math.cos(f1) * Math.cos(f2) * Math.sin(dl / 2) * Math.sin(dl / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      return R * c;
    }

    const handleGeolocation = (pos) => {
      const userLat = pos.coords.latitude
      const userLng = pos.coords.longitude

      if (settings?.geofenceEnabled && settings.geofenceLat && settings.geofenceLng) {
        const dist = getDistance(userLat, userLng, parseFloat(settings.geofenceLat), parseFloat(settings.geofenceLng))
        if (dist > (parseFloat(settings.geofenceRadius) || 50)) {
          showFeedback({
            type: 'error',
            title: 'Acesso Bloqueado por Cerca Virtual',
            message: `Você está fora da área permitida da empresa (Distância: ${Math.round(dist)}m). Aproxime-se do local de trabalho.`
          })
          setIsProcessing(false)
          setStep('select')
          return
        }
      }
      saveRecord({ lat: userLat, lng: userLng })
    }

    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        handleGeolocation,
        (err) => {
          if (settings?.geofenceEnabled) {
            showFeedback({
              type: 'warning',
              title: 'Acesso ao GPS Negado',
              message: 'Você precisa permitir a localização no navegador para registrar o ponto com a Cerca Virtual ativada.'
            })
            setIsProcessing(false)
            setStep('select')
            return
          }
          saveRecord(null)
        },
        { timeout: 15000, maximumAge: 0 }
      )
    } else {
      if (settings?.geofenceEnabled) {
        showFeedback({
          type: 'error',
          title: 'GPS Indisponível',
          message: 'Seu dispositivo não suporta GPS. Não é possível bater o ponto com Cerca Virtual.'
        })
        setIsProcessing(false)
        setStep('select')
        return
      }
      saveRecord(null)
    }
  }

  const isTypeDisabled = (type) => {
    const hasCheckIn = todayRecords.some(r => r.type === 'check_in')
    const hasCheckOut = todayRecords.some(r => r.type === 'check_out')
    const hasLunchOut = todayRecords.some(r => r.type === 'lunch_out')

    // If already checked out definitively, everything is disabled
    if (hasCheckOut) return true

    // If no records today, only "check_in" is allowed
    if (todayRecords.length === 0) {
      return type !== 'check_in'
    }

    // If already has a check_in, you can't check_in again
    if (type === 'check_in' && hasCheckIn) return true

    // Only 1 lunch per day allowed
    if (type === 'lunch_out' && hasLunchOut) return true

    const lastRecord = todayRecords[todayRecords.length - 1]
    const lastType = lastRecord.type

    switch (lastType) {
      case 'check_in':
        // After entry: Lunch out, Final exit, or Extra exit
        return !['lunch_out', 'check_out', 'other_out'].includes(type)

      case 'lunch_out':
        // During lunch: Only Lunch in allowed
        return type !== 'lunch_in'

      case 'lunch_in':
        // After returning from lunch: Final exit, Extra exit
        return !['check_out', 'other_out'].includes(type)

      case 'other_out':
        // During extra exit: Only Extra in allowed
        return type !== 'other_in'

      case 'other_in':
        // After returning from extra exit: Any exit allowed
        return !['lunch_out', 'check_out', 'other_out'].includes(type)

      default:
        return false
    }
  }

  const getSuggestedType = () => {
    if (todayRecords.length === 0) return 'check_in'
    const lastType = todayRecords[todayRecords.length - 1].type
    if (lastType === 'lunch_out') return 'lunch_in'
    if (lastType === 'other_out') return 'other_in'
    if (lastType === 'check_in' || lastType === 'other_in' || lastType === 'lunch_in') {
      const now = new Date()
      const nowMin = now.getHours() * 60 + now.getMinutes()

      const lunchStartMin = employee?.lunchStart ? toMinutes(employee.lunchStart) : (12 * 60)
      const lunchEndMin = employee?.lunchEnd ? toMinutes(employee.lunchEnd) : (13 * 60)
      const shiftEndMin = employee?.shiftEnd ? toMinutes(employee.shiftEnd) : (17 * 60)

      const hasLunchOut = todayRecords.some(r => r.type === 'lunch_out')

      // Se ainda não saiu para almoço e está na janela do horário de almoço do colaborador
      if (!hasLunchOut && nowMin >= (lunchStartMin - 45) && nowMin < lunchEndMin) {
        return 'lunch_out'
      }

      // Se está próximo ou já passou do horário de saída definitiva do colaborador
      if (nowMin >= (shiftEndMin - 45)) {
        return 'check_out'
      }
    }
    return null
  }

  if (!employee) return null

  return (
    <div
      className="relative flex flex-col items-center justify-center min-h-screen p-4 sm:p-6 overflow-hidden bg-slate-50 dark:bg-[#090D16] text-slate-900 dark:text-white transition-colors duration-500"
      onClick={handleContainerClick}
    >
      {/* Background Ambient Glows */}
      <div className="pointer-events-none absolute top-[-10%] right-[-10%] w-[450px] h-[450px] bg-blue-500/10 dark:bg-blue-600/15 rounded-full blur-[120px]" />
      <div className="pointer-events-none absolute bottom-[-10%] left-[-10%] w-[450px] h-[450px] bg-indigo-500/10 dark:bg-indigo-600/15 rounded-full blur-[120px]" />

      <button
        onClick={(e) => {
          e.stopPropagation()
          navigate({ to: '/' })
        }}
        className="absolute top-5 left-5 p-2.5 rounded-2xl bg-white/60 dark:bg-slate-900/60 border border-slate-200 dark:border-white/10 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-all shadow-sm active:scale-90 z-50 backdrop-blur-md"
        title="Voltar para busca"
      >
        <X className="w-5 h-5" />
      </button>

      <div className="absolute top-5 right-5 z-50">
        <ThemeToggle />
      </div>

      {step === 'pin' && (
        <div className="w-full max-w-sm space-y-6 text-center animate-in fade-in zoom-in duration-400 relative z-10">
          <input
            ref={inputRef}
            type="tel"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="off"
            value={pin}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            className="absolute top-0 left-0 w-px h-px opacity-0 overflow-hidden"
          />

          <div className="glass-panel p-8 rounded-[2.5rem] shadow-2xl space-y-6 border border-slate-200/80 dark:border-white/10">
            <div className="space-y-3">
              <div className="w-24 h-24 mx-auto rounded-3xl bg-gradient-to-tr from-blue-600/20 to-indigo-600/20 flex items-center justify-center border-2 border-blue-500/30 overflow-hidden shadow-lg p-0.5">
                {employee.photo ? (
                  <img src={employee.photo} alt={employee.name} className="w-full h-full object-cover rounded-[1.4rem]" />
                ) : (
                  <User className="w-10 h-10 text-blue-600 dark:text-blue-400" />
                )}
              </div>
              <div>
                <h2 className="text-xl font-extrabold text-slate-900 dark:text-white tracking-tight">{employee.name}</h2>
                <p className="text-xs text-slate-400 dark:text-slate-400 mt-0.5 font-medium">Digite seu PIN de 4 dígitos</p>
                {employee.autoPunchEnabled && (
                  <div className={`mt-3 px-3 py-1 rounded-full border text-[10px] font-black uppercase tracking-wider inline-flex items-center space-x-1.5 ${autoPunchTelemetry?.isInside
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
                      : 'bg-blue-500/10 border-blue-500/30 text-blue-600 dark:text-blue-400'
                    }`}>
                    <MapPin className="w-3 h-3 shrink-0 animate-pulse" />
                    <span>
                      {autoPunchTelemetry
                        ? `${autoPunchTelemetry.isInside ? 'Na Sala' : 'Fora'} (${autoPunchTelemetry.distance}m)`
                        : 'Auto-Ponto por Presença Ativo'}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* PIN Dots Indicator */}
            <div className="flex justify-center items-center space-x-4 py-2">
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className={`w-4 h-4 rounded-full transition-all duration-300 ${pin.length > i
                      ? 'bg-blue-600 border-2 border-blue-400 shadow-md shadow-blue-500/40 scale-125'
                      : error
                        ? 'border-2 border-red-500 bg-red-500/20 animate-pulse'
                        : 'border-2 border-slate-300 dark:border-slate-700 bg-slate-200/50 dark:bg-white/5'
                    }`}
                />
              ))}
            </div>

            {/* Keypad */}
            <div className="grid grid-cols-3 gap-3 max-w-[260px] mx-auto pt-2">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
                <button
                  key={num}
                  onClick={(e) => { e.stopPropagation(); handleNumber(num.toString()) }}
                  className="w-16 h-16 rounded-2xl bg-white/70 dark:bg-white/5 hover:bg-white dark:hover:bg-white/10 border border-slate-200/80 dark:border-white/10 text-2xl font-bold font-mono text-slate-900 dark:text-white transition-all shadow-sm active:scale-90 hover:shadow-md"
                >
                  {num}
                </button>
              ))}
              <button
                onClick={(e) => { e.stopPropagation(); handleDelete() }}
                className="w-16 h-16 rounded-2xl flex items-center justify-center text-slate-400 hover:text-slate-800 dark:hover:text-white hover:bg-slate-200/50 dark:hover:bg-white/5 transition-all active:scale-90"
                title="Apagar"
              >
                <Delete className="w-6 h-6" />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); handleNumber('0') }}
                className="w-16 h-16 rounded-2xl bg-white/70 dark:bg-white/5 hover:bg-white dark:hover:bg-white/10 border border-slate-200/80 dark:border-white/10 text-2xl font-bold font-mono text-slate-900 dark:text-white transition-all shadow-sm active:scale-90 hover:shadow-md"
              >
                0
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); handlePinSubmit() }}
                disabled={pin.length < 4}
                className={`w-16 h-16 rounded-2xl flex items-center justify-center transition-all active:scale-90 ${pin.length === 4
                    ? 'bg-gradient-to-tr from-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-500/30 hover:scale-105'
                    : 'text-slate-300 dark:text-slate-700 bg-slate-100 dark:bg-white/5 cursor-not-allowed'
                  }`}
                title="Confirmar"
              >
                <Check className="w-7 h-7" />
              </button>
            </div>

            {error && (
              <p className="text-red-500 text-xs font-bold animate-bounce bg-red-500/10 py-2 rounded-xl border border-red-500/20">
                Senha incorreta! Tente novamente.
              </p>
            )}
          </div>
        </div>
      )}

      {step === 'select' && (
        <div className="w-full max-w-2xl space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-400 relative z-10">
          <div className="glass-panel p-6 rounded-3xl shadow-xl flex items-center justify-between border border-slate-200/80 dark:border-white/10">
            <div className="flex items-center space-x-5 min-w-0">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-blue-600/20 to-indigo-600/20 flex items-center justify-center border border-blue-500/30 overflow-hidden flex-shrink-0 shadow-sm p-0.5">
                {employee.photo ? (
                  <img src={employee.photo} alt={employee.name} className="w-full h-full object-cover rounded-xl" />
                ) : (
                  <User className="w-8 h-8 text-blue-600 dark:text-blue-400" />
                )}
              </div>
              <div className="truncate">
                <h2 className="text-xl font-extrabold text-slate-900 dark:text-white tracking-tight truncate">
                  Olá, {employee.name.split(' ')[0]}!
                </h2>
                <div className="flex flex-wrap items-center gap-2 mt-1">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 shrink-0">
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                    {todayRecords.length === 0 ? 'Aguardando Entrada' : 'Jornada em andamento'}
                  </span>
                  <span className="text-xs text-slate-400 font-medium truncate">
                    • {todayRecords.length} registro(s) hoje
                  </span>
                  {employee.autoPunchEnabled && (
                    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider border shrink-0 ${autoPunchTelemetry?.isInside
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
                        : 'bg-blue-500/10 border-blue-500/30 text-blue-600 dark:text-blue-400'
                      }`}>
                      <MapPin className="w-2.5 h-2.5 shrink-0 animate-pulse" />
                      <span>{autoPunchTelemetry ? `${autoPunchTelemetry.isInside ? 'Na Sala' : 'Fora'} (${autoPunchTelemetry.distance}m)` : 'Auto-Ponto Ativo'}</span>
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Botão de Histórico de Notificações */}
            {employeeNotifications.length > 0 && (
              <button
                type="button"
                onClick={() => setShowEmployeeNotifsModal(true)}
                className="relative p-3 rounded-2xl bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 text-slate-600 dark:text-slate-300 transition-all border border-slate-200 dark:border-white/10 shrink-0"
                title="Minhas Notificações"
              >
                <Bell className="w-5 h-5" />
                {employeeNotifications.filter(n => !n.read).length > 0 && (
                  <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-[10px] font-black rounded-full flex items-center justify-center animate-pulse shadow-sm">
                    {employeeNotifications.filter(n => !n.read).length}
                  </span>
                )}
              </button>
            )}
          </div>

          {/* Cards de Notificações Não Lidas (Especialmente Indeferimentos) */}
          {employeeNotifications.filter(n => !n.read).length > 0 && (
            <div className="space-y-3">
              {employeeNotifications.filter(n => !n.read).map(notif => (
                <div
                  key={notif.id}
                  className={`p-6 rounded-3xl border-2 shadow-xl space-y-4 animate-in slide-in-from-top-3 ${notif.type === 'request_rejected'
                      ? 'bg-red-50 dark:bg-[#1a0b0e] border-red-300 dark:border-red-500/40 shadow-red-500/10'
                      : 'bg-emerald-50 dark:bg-[#091a12] border-emerald-300 dark:border-emerald-500/40 shadow-emerald-500/10'
                    }`}
                >
                  <div className="flex items-start space-x-4">
                    <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 text-white shadow-lg mt-0.5 ${notif.type === 'request_rejected' ? 'bg-red-600 shadow-red-600/30' : 'bg-emerald-600 shadow-emerald-600/30'
                      }`}>
                      {notif.type === 'request_rejected' ? <ShieldAlert className="w-6 h-6" /> : <CheckCircle2 className="w-6 h-6" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h4 className={`font-black text-sm uppercase tracking-wide ${notif.type === 'request_rejected' ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'
                          }`}>
                          {notif.title || (notif.type === 'request_rejected' ? 'Solicitação Indeferida' : 'Solicitação Deferida')}
                        </h4>
                        {notif.type === 'request_rejected' && (
                          <span className="px-2 py-0.5 rounded-full text-[9px] font-black bg-red-600 text-white uppercase animate-pulse">
                            Procure o RH
                          </span>
                        )}
                      </div>
                      <p className="text-xs font-bold mt-1 leading-relaxed text-slate-800 dark:text-slate-200">
                        {notif.message}
                      </p>
                      <p className="text-[10px] text-slate-400 font-mono mt-1.5">
                        {notif.timestamp && format(new Date(notif.timestamp), "dd/MM/yyyy 'às' HH:mm")}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2.5 pt-2 border-t border-black/5 dark:border-white/10">
                    <button
                      type="button"
                      onClick={async () => {
                        await db.notifications.update(notif.id, { read: true })
                        const updated = await db.notifications.get(notif.id)
                        if (updated) await pushDocToFirestore('notifications', notif.id, updated)
                        loadEmployeeNotifications()
                      }}
                      className="px-5 py-2.5 bg-white dark:bg-slate-800 hover:bg-slate-100 text-slate-700 dark:text-slate-200 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all border border-slate-200 dark:border-white/10 active:scale-95 shadow-sm"
                    >
                      Marcar como Ciente
                    </button>

                    {notif.recordId && (
                      <button
                        type="button"
                        onClick={async () => {
                          const rec = await db.records.get(notif.recordId)
                          if (rec) {
                            setSelectedTickets([rec])
                            setStep('ticket')
                          }
                        }}
                        className="px-5 py-2.5 bg-red-600 hover:bg-red-500 text-white rounded-xl text-[10px] font-black uppercase tracking-wider transition-all shadow-md shadow-red-600/30 active:scale-95 flex items-center space-x-1.5"
                      >
                        <FileText className="w-3.5 h-3.5" />
                        <span>Ver Recibo com Marca d'Água</span>
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Modal com Histórico Completo de Notificações */}
          {showEmployeeNotifsModal && (
            <div
              className="fixed inset-0 z-[150] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
              onClick={() => setShowEmployeeNotifsModal(false)}
            >
              <div
                className="relative max-w-lg w-full bg-white dark:bg-slate-900 rounded-[2.5rem] p-7 border border-slate-200 dark:border-white/10 shadow-2xl space-y-5 animate-in zoom-in duration-200 max-h-[85vh] flex flex-col"
                onClick={e => e.stopPropagation()}
              >
                <div className="flex justify-between items-center pb-2 border-b border-slate-100 dark:border-white/10">
                  <div className="flex items-center space-x-3">
                    <div className="w-10 h-10 rounded-2xl bg-blue-500/10 text-blue-600 flex items-center justify-center">
                      <Bell className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="text-base font-black text-slate-900 dark:text-white">Minhas Notificações</h3>
                      <p className="text-[10px] text-slate-400 font-bold">Histórico de comunicados da gestão</p>
                    </div>
                  </div>
                  <button onClick={() => setShowEmployeeNotifsModal(false)} className="p-2 text-slate-400 hover:text-slate-800 dark:hover:text-white rounded-xl">
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto space-y-3 pr-1">
                  {employeeNotifications.length === 0 ? (
                    <p className="text-center py-8 text-xs text-slate-400 font-medium">Nenhuma notificação registrada.</p>
                  ) : (
                    employeeNotifications.map(n => (
                      <div
                        key={n.id}
                        className={`p-4 rounded-2xl border text-xs space-y-2 ${n.type === 'request_rejected' ? 'bg-red-500/5 border-red-500/20 text-red-900 dark:text-red-200' : 'bg-emerald-500/5 border-emerald-500/20 text-emerald-900 dark:text-emerald-200'
                          }`}
                      >
                        <div className="flex justify-between items-start">
                          <span className={`font-black uppercase text-[10px] ${n.type === 'request_rejected' ? 'text-red-600' : 'text-emerald-600'}`}>
                            {n.title}
                          </span>
                          <span className="text-[9px] text-slate-400 font-mono">
                            {format(new Date(n.timestamp), 'dd/MM/yyyy HH:mm')}
                          </span>
                        </div>
                        <p className="font-medium leading-relaxed">{n.message}</p>
                      </div>
                    ))
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => setShowEmployeeNotifsModal(false)}
                  className="w-full py-3.5 bg-slate-100 dark:bg-white/5 text-slate-700 dark:text-slate-300 font-black rounded-2xl text-xs uppercase tracking-wider hover:bg-slate-200 transition-all"
                >
                  Fechar
                </button>
              </div>
            </div>
          )}

          {isDemo && (
            <div className="p-6 bg-orange-500/10 border border-orange-500/20 rounded-[2.5rem] space-y-4 animate-in slide-in-from-top-4 duration-500">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <div className="w-10 h-10 bg-orange-500 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-orange-500/20">
                    <Activity className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-tight">Ferramentas de Apresentação</h4>
                    <p className="text-[10px] text-orange-600 font-black uppercase tracking-widest">Modo Simulação Ativo</p>
                  </div>
                </div>
                <button
                  onClick={() => setSimulateTime(!simulateTime)}
                  className={`w-12 h-6 rounded-full transition-all relative ${simulateTime ? 'bg-orange-500' : 'bg-slate-300 dark:bg-slate-800'}`}
                >
                  <div className={`w-4 h-4 bg-white rounded-full absolute top-1 transition-all ${simulateTime ? 'left-7' : 'left-1'}`} />
                </button>
              </div>

              {simulateTime && (
                <div className="grid grid-cols-2 gap-4 animate-in zoom-in duration-300">
                  <div className="space-y-1">
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Simular Data</label>
                    <input type="date" className="w-full p-3 bg-white dark:bg-black/40 border border-black/5 dark:border-white/10 rounded-xl text-slate-900 dark:text-white text-xs font-black" value={customDate} onChange={e => setCustomDate(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Simular Horário</label>
                    <input type="time" className="w-full p-3 bg-white dark:bg-black/40 border border-black/5 dark:border-white/10 rounded-xl text-slate-900 dark:text-white text-xs font-black" value={customTime} onChange={e => setCustomTime(e.target.value)} />
                  </div>
                  <p className="col-span-2 text-[10px] text-slate-500 font-medium italic text-center">Neste modo, o ponto será registrado com o horário escolhido acima.</p>
                </div>
              )}
            </div>
          )}

          {/* Card de Banco de Horas em Tempo Real */}
          {timeBank && (
            <div className={`p-6 rounded-[2rem] border transition-all shadow-lg space-y-4 ${timeBank.status === 'credit'
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-950 dark:text-emerald-100 shadow-emerald-500/5'
                : timeBank.status === 'debt'
                  ? 'bg-red-500/10 border-red-500/30 text-red-950 dark:text-red-100 shadow-red-500/5'
                  : 'bg-blue-500/10 border-blue-500/30 text-blue-950 dark:text-blue-100 shadow-blue-500/5'
              }`}>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center space-x-3.5">
                  <div className={`w-11 h-11 rounded-2xl flex items-center justify-center text-white shadow-md shrink-0 ${timeBank.status === 'credit' ? 'bg-emerald-600 shadow-emerald-600/30' : timeBank.status === 'debt' ? 'bg-red-600 shadow-red-600/30' : 'bg-blue-600 shadow-blue-600/30'
                    }`}>
                    <Scale className="w-5 h-5" />
                  </div>
                  <div>
                    <span className="text-[10px] font-black uppercase tracking-widest block opacity-70">Banco de Horas • Mês Atual</span>
                    <h4 className="font-extrabold text-sm text-slate-900 dark:text-white flex items-center gap-1.5">
                      {timeBank.status === 'credit' && (
                        <>
                          <TrendingUp className="w-4 h-4 text-emerald-500" />
                          <span>Você tem Horas na Casa!</span>
                        </>
                      )}
                      {timeBank.status === 'debt' && (
                        <>
                          <TrendingDown className="w-4 h-4 text-red-500" />
                          <span>Você está devendo horas</span>
                        </>
                      )}
                      {timeBank.status === 'neutral' && (
                        <span>Saldo Rigorosamente em Dia</span>
                      )}
                    </h4>
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <span className={`px-3.5 py-1.5 rounded-2xl text-xs font-black font-mono inline-block tracking-tight ${timeBank.status === 'credit'
                      ? 'bg-emerald-500 text-white shadow-sm'
                      : timeBank.status === 'debt'
                        ? 'bg-red-500 text-white shadow-sm'
                        : 'bg-blue-500 text-white shadow-sm'
                    }`}>
                    {timeBank.balanceFormatted}
                  </span>
                </div>
              </div>

              <div className={`grid ${timeBank.totalExcusedMin > 0 ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-3'} gap-2.5 pt-3 border-t border-black/5 dark:border-white/10 text-center`}>
                <div className="p-3 rounded-2xl bg-white/60 dark:bg-black/30 border border-black/5 dark:border-white/5">
                  <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block">Previsto (CLT)</span>
                  <span className="text-xs font-black text-slate-800 dark:text-slate-200 font-mono mt-0.5 block">{timeBank.expectedFormatted}</span>
                </div>
                <div className="p-3 rounded-2xl bg-white/60 dark:bg-black/30 border border-black/5 dark:border-white/5">
                  <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block">Trabalhado</span>
                  <span className="text-xs font-black text-slate-800 dark:text-slate-200 font-mono mt-0.5 block">{timeBank.workedFormatted}</span>
                </div>
                {timeBank.totalExcusedMin > 0 && (
                  <div className="p-3 rounded-2xl bg-teal-500/10 border border-teal-500/20">
                    <span className="text-[9px] font-black text-teal-600 dark:text-teal-400 uppercase tracking-widest block">Abonado</span>
                    <span className="text-xs font-black text-teal-700 dark:text-teal-300 font-mono mt-0.5 block">+{timeBank.excusedFormatted}</span>
                  </div>
                )}
                <div className="p-3 rounded-2xl bg-white/60 dark:bg-black/30 border border-black/5 dark:border-white/5">
                  <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block">
                    {timeBank.status === 'credit' ? 'Horas Extras' : timeBank.status === 'debt' ? 'Devendo' : 'Saldo'}
                  </span>
                  <span className={`text-xs font-black font-mono mt-0.5 block ${timeBank.status === 'credit' ? 'text-emerald-600 dark:text-emerald-400' : timeBank.status === 'debt' ? 'text-red-600 dark:text-red-400' : 'text-blue-600 dark:text-blue-400'
                    }`}>
                    {timeBank.status === 'credit' ? `+${timeBank.overtimeFormatted}` : timeBank.status === 'debt' ? `-${timeBank.debtFormatted}` : '0h 00m'}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Banner de Liberação de Correção de Dia Excluído */}
          {employee?.allowDayCorrection && employee?.dayCorrectionDate && (
            <div className="p-6 bg-gradient-to-r from-amber-500/15 via-orange-500/15 to-amber-500/10 border border-amber-500/30 rounded-[2rem] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 animate-in slide-in-from-top-3 shadow-lg shadow-amber-500/5">
              <div className="flex items-center space-x-4">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-amber-500 to-orange-500 flex items-center justify-center text-white shadow-lg shadow-amber-500/30 shrink-0">
                  <RotateCcw className="w-6 h-6" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="font-black text-slate-900 dark:text-white text-base">Correção de Ponto Autorizada</h4>
                    <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-md bg-amber-500 text-white tracking-wider">Ajuste de Dia</span>
                  </div>
                  <p className="text-xs text-amber-800 dark:text-amber-300 font-medium mt-0.5">
                    A administração autorizou você a lançar manualmente as batidas do dia <strong>{format(new Date(employee.dayCorrectionDate + 'T12:00:00'), 'dd/MM/yyyy')}</strong> após exclusão dos registros anteriores.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleOpenDayCorrection()}
                className="w-full sm:w-auto px-6 py-3.5 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white rounded-2xl font-black text-xs uppercase tracking-wider transition-all shadow-lg shadow-amber-500/25 active:scale-95 shrink-0"
              >
                Lançar Batidas do Dia
              </button>
            </div>
          )}

          {/* Banner de Liberação de Dias Anteriores */}
          {employee?.allowRetroactive && employee?.retroactiveStart && employee?.retroactiveEnd && (
            <div className="p-6 bg-indigo-600/10 border border-indigo-500/30 rounded-[2rem] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 animate-in slide-in-from-top-3">
              <div className="flex items-center space-x-4">
                <div className="w-12 h-12 rounded-2xl bg-indigo-600 flex items-center justify-center text-white shadow-lg shadow-indigo-600/30 shrink-0">
                  <Calendar className="w-6 h-6" />
                </div>
                <div>
                  <h4 className="font-black text-slate-900 dark:text-white text-base">Inclusão de Dias Anteriores Liberada</h4>
                  <p className="text-xs text-indigo-600 dark:text-indigo-400 font-medium">
                    Autorizado de {format(new Date(employee.retroactiveStart + 'T12:00:00'), 'dd/MM/yyyy')} até {format(new Date(employee.retroactiveEnd + 'T12:00:00'), 'dd/MM/yyyy')}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setStep('retroactive_day')}
                className="w-full sm:w-auto px-6 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl font-black text-xs uppercase tracking-wider transition-all shadow-lg shadow-indigo-600/20 active:scale-95 shrink-0"
              >
                Lançar Pontos
              </button>
            </div>
          )}

          {/* Card de Ponto Esquecido no Mesmo Dia */}
          <div className="p-6 bg-orange-500/10 border border-orange-500/30 rounded-[2rem] space-y-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-2xl bg-orange-500 text-white flex items-center justify-center shadow-lg shadow-orange-500/20 shrink-0">
                  <Clock className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="font-black text-slate-900 dark:text-white text-sm">Esqueceu de bater no horário exato?</h4>
                  <p className="text-xs text-orange-600 dark:text-orange-400 font-medium">Declare a sua chegada retroativa para aprovação da administração</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsForgottenOpen(!isForgottenOpen)}
                className="w-full sm:w-auto px-5 py-2.5 bg-orange-500 hover:bg-orange-600 text-white rounded-xl font-black text-xs uppercase tracking-wider transition-all shadow-md shadow-orange-500/20 active:scale-95 shrink-0"
              >
                {isForgottenOpen ? 'Fechar Declaração' : 'Declarar Chegada'}
              </button>
            </div>

            {isForgottenOpen && (
              <div className="p-5 bg-white/80 dark:bg-black/50 rounded-2xl border border-orange-500/20 space-y-4 animate-in zoom-in duration-300">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block ml-1">Tipo de Registro</label>
                    <select
                      value={forgottenType}
                      onChange={e => setForgottenType(e.target.value)}
                      className="w-full p-3.5 bg-white dark:bg-slate-900 border border-black/10 dark:border-white/10 rounded-xl text-slate-900 dark:text-white font-bold text-xs outline-none focus:ring-2 focus:ring-orange-500"
                    >
                      <option value="check_in">Entrada Principal</option>
                      <option value="lunch_in">Retorno Refeição (Volta do Almoço)</option>
                      <option value="check_out">Saída Definitiva</option>
                      <option value="lunch_out">Saída Refeição</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block ml-1">Horário Real em que Chegou</label>
                    <input
                      type="time"
                      value={forgottenTime}
                      onChange={e => setForgottenTime(e.target.value)}
                      className="w-full p-3 bg-white dark:bg-slate-900 border border-black/10 dark:border-white/10 rounded-xl text-slate-900 dark:text-white font-black text-lg text-center outline-none focus:ring-2 focus:ring-orange-500"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block ml-1">Justificativa do Esquecimento</label>
                  <input
                    type="text"
                    placeholder="Ex: Cheguei às 08h, fui direto atender cliente e esqueci de registrar..."
                    value={forgottenReason}
                    onChange={e => setForgottenReason(e.target.value)}
                    className="w-full p-3.5 bg-white dark:bg-slate-900 border border-black/10 dark:border-white/10 rounded-xl text-slate-900 dark:text-white text-xs outline-none focus:ring-2 focus:ring-orange-500"
                  />
                </div>

                <button
                  type="button"
                  onClick={handleStartForgottenRecord}
                  className="w-full py-4 bg-orange-500 hover:bg-orange-600 text-white font-black rounded-xl text-xs uppercase tracking-widest transition-all shadow-lg shadow-orange-500/20 active:scale-95 flex items-center justify-center space-x-2"
                >
                  <Camera className="w-4 h-4" />
                  <span>Prosseguir para Foto Selfie e Confirmar</span>
                </button>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            {Object.entries(RECORD_TYPES).map(([key, config]) => {
              const Icon = config.icon
              const isSelected = selectedType === key
              const disabled = isTypeDisabled(key)
              const isSuggested = getSuggestedType() === key

              return (
                <div key={key} className="space-y-2">
                  <button
                    disabled={disabled}
                    onClick={() => handleRecord(key)}
                    className={`w-full p-4 rounded-2xl border transition-all flex items-center justify-between group active:scale-[0.98] ${disabled
                        ? 'opacity-35 grayscale cursor-not-allowed bg-slate-100/50 dark:bg-slate-900/30 border-slate-200/50 dark:border-white/5'
                        : isSelected
                          ? 'glass-card border-blue-500/80 ring-2 ring-blue-500/40 shadow-lg shadow-blue-500/10'
                          : isSuggested
                            ? 'bg-blue-500/10 border-blue-500/40 hover:bg-blue-500/15 shadow-md shadow-blue-500/10'
                            : 'glass-card border-slate-200/80 dark:border-white/5 hover:border-slate-300 dark:hover:border-white/20'
                      }`}
                  >
                    <div className="flex items-center space-x-3.5">
                      <div className={`w-12 h-12 rounded-xl ${disabled ? 'bg-slate-400 dark:bg-slate-800 text-slate-500' : config.color} text-white flex items-center justify-center shadow-md transition-transform group-hover:scale-105 shrink-0`}>
                        <Icon className="w-6 h-6" />
                      </div>
                      <div className="text-left">
                        <span className="font-bold text-base block text-slate-900 dark:text-white leading-tight">{config.label}</span>
                        {isSuggested ? (
                          <span className="inline-flex items-center gap-1 text-[10px] text-blue-600 dark:text-blue-400 uppercase font-black tracking-wider mt-0.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                            Sugerido agora
                          </span>
                        ) : (
                          <span className="text-[11px] text-slate-400 font-medium">Toque para bater</span>
                        )}
                      </div>
                    </div>
                    {!disabled && (
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center transition-all ${isSelected ? 'bg-blue-600 text-white' : 'text-slate-300 dark:text-slate-600 group-hover:text-blue-500'}`}>
                        <Check className="w-4 h-4" />
                      </div>
                    )}
                  </button>

                  {isSelected && config.needsReason && (
                    <div className="p-4 bg-black/5 dark:bg-white/5 rounded-2xl border border-blue-500/30 space-y-4 animate-in fade-in slide-in-from-top-2">
                      <p className="text-xs font-black text-blue-500 uppercase tracking-widest flex items-center justify-center">
                        <AlertCircle className="w-4 h-4 mr-2" />
                        Selecione o tipo de saída
                      </p>

                      <div className="grid grid-cols-1 gap-2">
                        {[
                          { id: 'medico', label: 'Médico', icon: Activity, desc: 'Pendente de Atestado' },
                          { id: 'pessoal', label: 'Pessoal', icon: User, desc: 'Desconta das Horas' },
                          { id: 'servico', label: 'A Serviço', icon: Clock, desc: 'Conta como Trabalho' }
                        ].map(cat => (
                          <button
                            key={cat.id}
                            onClick={() => handleRecord(key, cat.id)}
                            className="flex items-center justify-between p-4 bg-white/60 dark:bg-black/40 hover:bg-white/80 dark:hover:bg-black/60 border border-black/10 dark:border-white/10 rounded-xl transition-all group/cat"
                          >
                            <div className="flex items-center space-x-3">
                              <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center group-hover/cat:scale-110 transition-transform">
                                <cat.icon className="w-5 h-5 text-blue-500" />
                              </div>
                              <div className="text-left">
                                <span className="text-sm font-bold block">{cat.label}</span>
                                <span className="text-[10px] text-slate-500 uppercase font-bold">{cat.desc}</span>
                              </div>
                            </div>
                            <ChevronRight className="w-4 h-4 text-slate-400 group-hover/cat:translate-x-1 transition-transform" />
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {todayRecords.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between px-2">
                <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider">Registros de hoje</h3>
                <span className="text-[10px] text-slate-600">{todayRecords.length} ponto(s) registrados</span>
              </div>
              <div className="grid grid-cols-1 gap-2">
                {todayRecords.map((record, idx) => (
                  <div key={idx} className="flex items-center justify-between bg-black/5 dark:bg-white/5 p-4 rounded-2xl border border-black/5 dark:border-white/5 hover:bg-black/10 dark:bg-white/10 transition-colors">
                    <div className="flex items-center space-x-3">
                      <div className={`w-2 h-2 rounded-full ${RECORD_TYPES[record.type]?.color || 'bg-slate-500'}`} />
                      <div>
                        <p className="text-sm font-medium text-slate-600 dark:text-slate-300">{RECORD_TYPES[record.type]?.label}</p>
                        {record.comment && <p className="text-[10px] text-slate-500 truncate max-w-[200px]">{record.comment}</p>}
                      </div>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Clock className="w-3 h-3 text-slate-600" />
                      <span className="font-mono text-blue-400 font-bold">{format(new Date(record.timestamp), 'HH:mm')}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {isTypeDisabled('check_out') && todayRecords.some(r => r.type === 'check_out') && (
            <div className="bg-emerald-500/10 border border-emerald-500/30 p-4 rounded-2xl flex items-center space-x-3 text-emerald-400">
              <Info className="w-5 h-5" />
              <p className="text-sm">Jornada de hoje concluída! Até amanhã.</p>
            </div>
          )}

          <div className="pt-4 border-t border-black/10 dark:border-white/10">
            <button
              onClick={() => {
                loadHistoryRecords()
                setStep('history')
              }}
              className="w-full py-4 bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:bg-white/10 text-slate-700 dark:text-slate-300 font-bold rounded-2xl transition-all active:scale-[0.98] flex items-center justify-center border border-black/10 dark:border-white/10"
            >
              <FileText className="w-5 h-5 mr-2 text-blue-500" />
              Portal do Funcionário (Meus Comprovantes)
            </button>
          </div>

          {isProcessing && (
            <div className="fixed inset-0 z-[100] bg-slate-50 dark:bg-slate-950/80 backdrop-blur-sm flex flex-col items-center justify-center space-y-4 animate-in fade-in">
              <div className="w-12 h-12 border-4 border-blue-500/20 border-t-blue-500 rounded-full animate-spin" />
              <p className="text-blue-400 font-bold tracking-widest uppercase text-[10px]">Autenticando & Capturando GPS...</p>
            </div>
          )}
        </div>
      )}

      {step === 'camera' && (
        <div className="w-full max-w-sm text-center space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="space-y-2">
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center justify-center"><Camera className="w-6 h-6 mr-2 text-blue-500" /> Confirmação de Identidade</h2>
            <p className="text-slate-500 dark:text-slate-400 text-sm">Por favor, posicione seu rosto no quadro abaixo.</p>
          </div>

          <div className="relative mx-auto w-64 h-64 rounded-full overflow-hidden border-4 border-blue-500/30 shadow-2xl shadow-blue-500/20">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover scale-x-[-1]"
            />
            <div className="absolute inset-0 border-4 border-blue-500 rounded-full opacity-50" />
            <div className="absolute top-1/2 left-0 w-full h-0.5 bg-blue-500/30 shadow-[0_0_10px_rgba(59,130,246,0.5)] animate-scan" />
          </div>

          <button
            onClick={capturePhoto}
            className="w-full py-5 bg-blue-600 hover:bg-blue-500 text-slate-900 dark:text-white font-black rounded-2xl shadow-xl shadow-blue-900/20 transition-all active:scale-[0.98] uppercase tracking-widest text-sm"
          >
            Capturar e Confirmar
          </button>

          <button
            onClick={() => setStep('select')}
            className="w-full py-3 text-slate-500 hover:text-slate-900 dark:text-white text-xs font-bold uppercase tracking-widest transition-colors"
          >
            Voltar
          </button>

          <canvas ref={canvasRef} className="hidden" />

          {isProcessing && (
            <div className="fixed inset-0 z-[100] bg-slate-50 dark:bg-slate-950/80 backdrop-blur-sm flex flex-col items-center justify-center space-y-4 animate-in fade-in">
              <div className="w-12 h-12 border-4 border-blue-500/20 border-t-blue-500 rounded-full animate-spin" />
              <p className="text-blue-400 font-bold tracking-widest uppercase text-[10px]">Autenticando & Capturando GPS...</p>
            </div>
          )}
        </div>
      )}

      {step === 'success' && (
        <div className="w-full max-w-sm text-center space-y-6 animate-in fade-in zoom-in duration-400 relative z-10">
          {/* Animated Success Badge with Pulse Ring */}
          <div className="relative mx-auto w-24 h-24">
            <div className="absolute inset-0 bg-emerald-500/20 rounded-full animate-ping" />
            <div className="relative w-24 h-24 rounded-3xl bg-gradient-to-tr from-emerald-500 to-teal-500 flex items-center justify-center shadow-xl shadow-emerald-500/30">
              <Check className="w-12 h-12 text-white stroke-[3px]" />
            </div>
          </div>

          <div className="space-y-1">
            <h2 className="text-2xl font-extrabold text-emerald-500 dark:text-emerald-400 tracking-tight">
              Ponto Registrado!
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 font-medium">
              Identidade e horário autenticados com sucesso
            </p>
          </div>

          {/* Mini Wallet Pass Card */}
          <div className="glass-panel p-6 rounded-3xl border border-slate-200/80 dark:border-white/10 shadow-xl text-left space-y-4 relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-emerald-500 via-teal-400 to-emerald-500" />

            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Tipo de Registro</p>
                <p className="text-base font-extrabold text-slate-900 dark:text-white leading-tight">
                  {RECORD_TYPES[selectedType]?.label}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Horário Gravado</p>
                <p className="text-2xl font-extrabold font-mono text-emerald-600 dark:text-emerald-400">
                  {format(recordedTime, 'HH:mm:ss')}
                </p>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-200/60 dark:border-white/10 flex items-center justify-between text-xs">
              <span className="text-slate-400 font-medium font-mono">{format(recordedTime, 'dd/MM/yyyy')}</span>
              <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-bold text-[11px]">
                <ShieldCheck className="w-3.5 h-3.5" />
                Criptografia SHA-256
              </span>
            </div>

            {extraCategory === 'esquecimento' && (
              <div className="p-3 bg-orange-500/10 border border-orange-500/20 rounded-xl space-y-1 animate-in slide-in-from-bottom-2">
                <div className="flex items-center space-x-1.5 text-orange-600 dark:text-orange-400 font-bold text-[11px] uppercase tracking-wider">
                  <Clock className="w-3.5 h-3.5" />
                  <span>Ajuste de Chegada Declarado</span>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-300">
                  Horário declarado: <strong className="text-orange-600 dark:text-orange-400 font-mono">{forgottenTime}</strong> (em análise pelo administrador).
                </p>
              </div>
            )}
          </div>

          <div className="flex flex-col space-y-2.5 pt-1">
            <button
              onClick={handleShareReceipt}
              className="w-full py-4 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold rounded-2xl shadow-lg shadow-emerald-500/25 transition-all active:scale-[0.98] text-xs uppercase tracking-wider flex items-center justify-center space-x-2"
            >
              <Share2 className="w-4 h-4" />
              <span>Ver Comprovante Digital (Ticket)</span>
            </button>

            <button
              onClick={() => navigate({ to: '/' })}
              className="w-full py-3 glass-card rounded-2xl text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white text-xs font-bold uppercase tracking-wider transition-all active:scale-[0.98]"
            >
              Concluir e Voltar
            </button>
          </div>

          <div className="inline-flex items-center space-x-2 px-3.5 py-1.5 rounded-full bg-slate-100 dark:bg-white/5 border border-slate-200/50 dark:border-white/5 text-slate-400 text-[10px] font-semibold tracking-wider uppercase">
            <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
            <span>Retornando ao início automaticamente...</span>
          </div>
        </div>
      )}

      {step === 'day_correction' && (
        <div className="w-full max-w-3xl space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-16">
          <button
            type="button"
            onClick={() => setStep('select')}
            className="flex items-center space-x-2 text-slate-500 hover:text-slate-900 dark:hover:text-white transition-colors text-sm font-bold"
          >
            <X className="w-4 h-4" />
            <span>Cancelar e Voltar</span>
          </button>

          <div className="text-center space-y-2">
            <div className="w-16 h-16 bg-amber-500/20 rounded-2xl flex items-center justify-center mx-auto mb-2 text-amber-500 border border-amber-500/30">
              <RotateCcw className="w-8 h-8" />
            </div>
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-600 dark:text-amber-400 text-xs font-black uppercase tracking-wider mb-1">
              <span>Ajuste Manual Autorizado</span>
            </div>
            <h2 className="text-2xl md:text-3xl font-black text-slate-900 dark:text-white tracking-tight">
              Correção de Pontos do Dia
            </h2>
            <p className="text-slate-500 dark:text-slate-400 text-sm">
              Dia liberado pela gestão: <strong className="text-amber-600 dark:text-amber-400 text-base">{correctionDate ? format(new Date(correctionDate + 'T12:00:00'), 'dd/MM/yyyy') : ''}</strong>
            </p>
          </div>

          <form onSubmit={handleSubmitDayCorrection} className="p-6 md:p-8 bg-white dark:bg-slate-900 rounded-3xl border border-black/10 dark:border-white/10 space-y-6 shadow-xl">
            {/* Banner Explicativo */}
            <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-2xl flex items-start space-x-3 text-xs text-amber-900 dark:text-amber-200">
              <Info className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="font-bold">Como funciona a correção manual de dia excluído:</p>
                <p className="text-[11px] leading-relaxed opacity-90">
                  Os pontos anteriores desta data foram excluídos pela administração. Preencha abaixo os horários reais em que você trabalhou neste dia. As batidas serão enviadas para a Central de Aprovações do Administrador e, assim que deferidas, a função será automaticamente concluída e bloqueada para novos lançamentos.
                </p>
              </div>
            </div>

            {/* Grade de Horários */}
            <div className="space-y-3">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block ml-1">
                Horários das Batidas do Dia
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-emerald-600 dark:text-emerald-400 uppercase tracking-widest block ml-1">
                    1. Entrada
                  </label>
                  <input
                    type="time"
                    required
                    value={correctionCheckIn}
                    onChange={e => setCorrectionCheckIn(e.target.value)}
                    className="w-full p-3.5 bg-slate-50 dark:bg-black/40 border border-black/10 dark:border-white/10 rounded-2xl text-slate-900 dark:text-white font-black text-lg text-center outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>

                {correctionHasLunch ? (
                  <>
                    <div className="space-y-1">
                      <label className="text-[10px] font-black text-amber-600 dark:text-amber-400 uppercase tracking-widest block ml-1">
                        2. Saída Almoço
                      </label>
                      <input
                        type="time"
                        required={correctionHasLunch}
                        value={correctionLunchOut}
                        onChange={e => setCorrectionLunchOut(e.target.value)}
                        className="w-full p-3.5 bg-slate-50 dark:bg-black/40 border border-black/10 dark:border-white/10 rounded-2xl text-slate-900 dark:text-white font-black text-lg text-center outline-none focus:ring-2 focus:ring-amber-500"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-[10px] font-black text-blue-600 dark:text-blue-400 uppercase tracking-widest block ml-1">
                        3. Volta Almoço
                      </label>
                      <input
                        type="time"
                        required={correctionHasLunch}
                        value={correctionLunchIn}
                        onChange={e => setCorrectionLunchIn(e.target.value)}
                        className="w-full p-3.5 bg-slate-50 dark:bg-black/40 border border-black/10 dark:border-white/10 rounded-2xl text-slate-900 dark:text-white font-black text-lg text-center outline-none focus:ring-2 focus:ring-amber-500"
                      />
                    </div>
                  </>
                ) : null}

                <div className="space-y-1">
                  <label className="text-[10px] font-black text-rose-600 dark:text-rose-400 uppercase tracking-widest block ml-1">
                    {correctionHasLunch ? '4. Saída Definitiva' : '2. Saída Definitiva'}
                  </label>
                  <input
                    type="time"
                    required
                    value={correctionCheckOut}
                    onChange={e => setCorrectionCheckOut(e.target.value)}
                    className="w-full p-3.5 bg-slate-50 dark:bg-black/40 border border-black/10 dark:border-white/10 rounded-2xl text-slate-900 dark:text-white font-black text-lg text-center outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>
              </div>

              <div className="flex items-center space-x-3 pt-2">
                <input
                  type="checkbox"
                  id="correctionLunchCheck"
                  checked={correctionHasLunch}
                  onChange={e => setCorrectionHasLunch(e.target.checked)}
                  className="w-4 h-4 rounded text-amber-600 focus:ring-amber-500 cursor-pointer"
                />
                <label htmlFor="correctionLunchCheck" className="text-xs font-bold text-slate-700 dark:text-slate-300 cursor-pointer select-none">
                  Incluir intervalo de almoço / refeição (4 batidas no dia)
                </label>
              </div>
            </div>

            {/* Justificativa */}
            <div className="space-y-2 pt-2 border-t border-black/5 dark:border-white/5">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block ml-1">
                Justificativa / Observação do Colaborador
              </label>
              <textarea
                rows={3}
                placeholder="Ex: Regularização dos horários praticados após alinhamento com a gestão..."
                value={correctionReason}
                onChange={e => setCorrectionReason(e.target.value)}
                className="w-full p-4 bg-slate-50 dark:bg-black/40 border border-black/10 dark:border-white/10 rounded-2xl text-xs text-slate-900 dark:text-white font-medium outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>

            {/* Botões */}
            <div className="flex flex-col sm:flex-row gap-3 pt-4 border-t border-black/5 dark:border-white/5">
              <button
                type="button"
                onClick={() => setStep('select')}
                className="w-full sm:w-1/3 py-4 bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-white/10 rounded-2xl font-black text-xs uppercase tracking-wider transition-all"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={isSubmittingCorrection}
                className="w-full sm:flex-1 py-4 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white font-black rounded-2xl text-xs uppercase tracking-wider transition-all shadow-xl shadow-amber-500/25 active:scale-95 disabled:opacity-50 flex items-center justify-center space-x-2"
              >
                {isSubmittingCorrection ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Enviando Correção...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Enviar Correção para Aprovação</span>
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      )}

      {step === 'retroactive_day' && (
        <div className="w-full max-w-3xl space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-16">
          <button
            onClick={() => setStep('select')}
            className="flex items-center space-x-2 text-slate-500 hover:text-slate-900 dark:text-white transition-colors text-sm font-bold"
          >
            <X className="w-4 h-4" />
            <span>Cancelar e Voltar</span>
          </button>

          <div className="text-center space-y-2">
            <div className="w-16 h-16 bg-indigo-600/20 rounded-2xl flex items-center justify-center mx-auto mb-2 text-indigo-500 border border-indigo-500/30">
              <Calendar className="w-8 h-8" />
            </div>
            <h2 className="text-2xl md:text-3xl font-black text-slate-900 dark:text-white tracking-tight">
              Lançar Ponto de Dias Anteriores
            </h2>
            <p className="text-slate-500 dark:text-slate-400 text-sm">
              Período autorizado pela gestão: <strong className="text-indigo-600 dark:text-indigo-400">{employee?.retroactiveStart ? format(new Date(employee.retroactiveStart + 'T12:00:00'), 'dd/MM/yyyy') : ''}</strong> até <strong className="text-indigo-600 dark:text-indigo-400">{employee?.retroactiveEnd ? format(new Date(employee.retroactiveEnd + 'T12:00:00'), 'dd/MM/yyyy') : ''}</strong>.
            </p>
          </div>

          {/* Seletor de Modo: Lote (Período) vs Individual (Avulso) */}
          <div className="grid grid-cols-2 gap-3 p-1.5 bg-slate-100 dark:bg-slate-900 rounded-2xl border border-black/5 dark:border-white/10 max-w-md mx-auto">
            <button
              type="button"
              onClick={() => {
                setRetroMode('batch')
                if (retroDaysList.length === 0) initRetroDays(employee)
              }}
              className={`py-3 px-4 rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center justify-center space-x-2 ${retroMode === 'batch'
                  ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
            >
              <Sparkles className="w-4 h-4" />
              <span>Período Completo</span>
            </button>
            <button
              type="button"
              onClick={() => setRetroMode('single')}
              className={`py-3 px-4 rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center justify-center space-x-2 ${retroMode === 'single'
                  ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
            >
              <Clock className="w-4 h-4" />
              <span>Ponto Avulso</span>
            </button>
          </div>

          {retroMode === 'batch' ? (
            <div className="space-y-8">
              {/* CARD 1: MODELO DE PREENCHIMENTO RÁPIDO */}
              <div className="p-6 md:p-8 bg-white dark:bg-slate-900 rounded-3xl border border-black/10 dark:border-white/10 space-y-5 shadow-xl">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-black/5 dark:border-white/5">
                  <div className="flex items-center space-x-3">
                    <div className="w-10 h-10 rounded-xl bg-indigo-500/10 text-indigo-500 flex items-center justify-center font-black">
                      <Clock className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="flex items-center space-x-2">
                        <h4 className="font-black text-slate-900 dark:text-white text-base">Preenchimento Rápido (Horários Praticados)</h4>
                        <span className="px-2 py-0.5 rounded-md bg-indigo-100 dark:bg-indigo-950/50 text-[10px] font-black uppercase text-indigo-600 dark:text-indigo-400">
                          Modelo
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                        Horários sugeridos com base na sua escala cadastrada pelo RH para replicar rapidamente nos dias trabalhados
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleApplyTemplateToAll}
                    className="inline-flex items-center justify-center space-x-2 px-4 py-2.5 bg-indigo-50 dark:bg-indigo-950/40 hover:bg-indigo-100 dark:hover:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20 rounded-xl text-xs font-black uppercase tracking-wider transition-all active:scale-95 shrink-0"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>Aplicar aos Dias Selecionados</span>
                  </button>
                </div>

                {/* AVISO DE DISTINÇÃO ENTRE JORNADA CONTRATUAL E REGISTRO DE PONTO */}
                <div className="p-4 bg-blue-500/10 border border-blue-500/20 rounded-2xl flex items-start space-x-3">
                  <Info className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
                  <div className="text-[11px] text-blue-900 dark:text-blue-200 font-medium leading-relaxed space-y-1">
                    <p>
                      <strong>Nota sobre sua Jornada:</strong> Sua carga horária contratual oficial continua sendo exclusivamente a cadastrada pelo RH no sistema (ela serve de régua para medir banco de horas e horas extras).
                    </p>
                    <p className="text-blue-700/80 dark:text-blue-300/80 text-[10px]">
                      Os horários deste modelo servem para facilitar o preenchimento dos horários reais que você cumpriu. Todo envio entrará como pendente e passará pela validação e aprovação do Administrador.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-emerald-600 dark:text-emerald-400 uppercase tracking-widest block ml-1">
                      1. Entrada
                    </label>
                    <input
                      type="time"
                      value={templateIn}
                      onChange={e => setTemplateIn(e.target.value)}
                      className="w-full p-3 bg-slate-50 dark:bg-black/40 border border-black/10 dark:border-white/10 rounded-2xl text-slate-900 dark:text-white font-black text-lg text-center outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>

                  {templateHasLunch ? (
                    <>
                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-amber-600 dark:text-amber-400 uppercase tracking-widest block ml-1">
                          2. Saída Almoço
                        </label>
                        <input
                          type="time"
                          value={templateLunchOut}
                          onChange={e => setTemplateLunchOut(e.target.value)}
                          className="w-full p-3 bg-slate-50 dark:bg-black/40 border border-black/10 dark:border-white/10 rounded-2xl text-slate-900 dark:text-white font-black text-lg text-center outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-blue-600 dark:text-blue-400 uppercase tracking-widest block ml-1">
                          3. Volta Almoço
                        </label>
                        <input
                          type="time"
                          value={templateLunchIn}
                          onChange={e => setTemplateLunchIn(e.target.value)}
                          className="w-full p-3 bg-slate-50 dark:bg-black/40 border border-black/10 dark:border-white/10 rounded-2xl text-slate-900 dark:text-white font-black text-lg text-center outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                      </div>
                    </>
                  ) : null}

                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-rose-600 dark:text-rose-400 uppercase tracking-widest block ml-1">
                      {templateHasLunch ? '4. Saída Definitiva' : '2. Saída Definitiva'}
                    </label>
                    <input
                      type="time"
                      value={templateOut}
                      onChange={e => setTemplateOut(e.target.value)}
                      className="w-full p-3 bg-slate-50 dark:bg-black/40 border border-black/10 dark:border-white/10 rounded-2xl text-slate-900 dark:text-white font-black text-lg text-center outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                </div>

                <div className="flex items-center space-x-3 pt-1">
                  <input
                    type="checkbox"
                    id="templateLunchCheck"
                    checked={templateHasLunch}
                    onChange={e => setTemplateHasLunch(e.target.checked)}
                    className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500"
                  />
                  <label htmlFor="templateLunchCheck" className="text-xs font-bold text-slate-700 dark:text-slate-300 cursor-pointer select-none">
                    Incluir intervalo de refeição/almoço (4 batidas por dia)
                  </label>
                </div>
              </div>

              {/* CARD 2: DIAS DO PERÍODO */}
              <div className="p-6 md:p-8 bg-white dark:bg-slate-900 rounded-3xl border border-black/10 dark:border-white/10 space-y-6 shadow-xl">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-black/5 dark:border-white/5">
                  <div>
                    <h4 className="font-black text-slate-900 dark:text-white text-base">Dias para Lançamento</h4>
                    <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                      Marque os dias que você trabalhou e ajuste os horários se necessário
                    </p>
                  </div>

                  <div className="flex items-center space-x-2 shrink-0">
                    <button
                      type="button"
                      onClick={handleSelectAllWorkDays}
                      className="px-3 py-1.5 bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 text-slate-700 dark:text-slate-300 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all"
                    >
                      Dias Úteis
                    </button>
                    <button
                      type="button"
                      onClick={handleSelectAllDays}
                      className="px-3 py-1.5 bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 text-slate-700 dark:text-slate-300 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all"
                    >
                      Todos
                    </button>
                    <button
                      type="button"
                      onClick={handleDeselectAll}
                      className="px-3 py-1.5 bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 text-slate-700 dark:text-slate-300 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all"
                    >
                      Limpar
                    </button>
                  </div>
                </div>

                {isLoadingRetroDays ? (
                  <div className="py-12 text-center space-y-3">
                    <div className="w-8 h-8 border-3 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto" />
                    <p className="text-xs font-bold text-slate-500">Carregando calendário do período...</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {retroDaysList.map(day => (
                      <div
                        key={day.dateStr}
                        className={`p-4 md:p-5 rounded-2xl border transition-all ${day.selected
                            ? 'bg-indigo-50/60 dark:bg-indigo-950/20 border-indigo-500/30 shadow-sm'
                            : 'bg-slate-50/50 dark:bg-black/20 border-black/5 dark:border-white/5 opacity-70'
                          }`}
                      >
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                          <label className="flex items-center space-x-3 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={day.selected}
                              onChange={() => handleToggleDay(day.dateStr)}
                              className="w-5 h-5 rounded-lg text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                            />
                            <div>
                              <div className="flex items-center space-x-2">
                                <span className="font-black text-slate-900 dark:text-white text-sm">
                                  {day.fullDateDisplay}
                                </span>
                                <span className="text-xs font-bold text-slate-500 dark:text-slate-400">
                                  • {day.dayName}
                                </span>
                              </div>
                              <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                                <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-md ${
                                  day.isHoliday
                                    ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30'
                                    : day.isWorkDay
                                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                                    : 'bg-slate-200 dark:bg-white/10 text-slate-600 dark:text-slate-400'
                                }`}>
                                  {day.workDayLabel}
                                </span>
                                {day.isHoliday && day.selected && (
                                  <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-md bg-purple-500/15 text-purple-700 dark:text-purple-300 border border-purple-500/30">
                                    ⭐ Trabalho em Feriado (100% / Escala)
                                  </span>
                                )}
                                {day.existingCount > 0 && (
                                  <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400">
                                    ⚠️ {day.existingCount} ponto(s) existente(s)
                                  </span>
                                )}
                              </div>
                              {day.existingCount > 0 && (
                                <p className="text-[10px] font-medium text-amber-700 dark:text-amber-300 mt-1">
                                  Já no espelho: {day.existingSummary}
                                </p>
                              )}
                            </div>
                          </label>

                          {day.selected && (
                            <div className="flex items-center space-x-2 shrink-0">
                              <label className="text-[10px] font-bold text-slate-500 flex items-center space-x-1.5 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={day.hasLunch}
                                  onChange={e => handleUpdateDayField(day.dateStr, 'hasLunch', e.target.checked)}
                                  className="w-3.5 h-3.5 rounded text-indigo-600 focus:ring-indigo-500"
                                />
                                <span>Almoço</span>
                              </label>
                            </div>
                          )}
                        </div>

                        {day.selected && (
                          <div className="mt-4 pt-3 border-t border-indigo-500/15 grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                            <div className="space-y-1">
                              <span className="text-[9px] font-black uppercase tracking-wider text-emerald-600 block">Entrada</span>
                              <input
                                type="time"
                                value={day.checkIn}
                                onChange={e => handleUpdateDayField(day.dateStr, 'checkIn', e.target.value)}
                                className="w-full p-2 bg-white dark:bg-slate-900 border border-black/10 dark:border-white/10 rounded-xl text-center text-xs font-black text-slate-900 dark:text-white"
                              />
                            </div>

                            {day.hasLunch && (
                              <>
                                <div className="space-y-1">
                                  <span className="text-[9px] font-black uppercase tracking-wider text-amber-600 block">Saída Almoço</span>
                                  <input
                                    type="time"
                                    value={day.lunchOut}
                                    onChange={e => handleUpdateDayField(day.dateStr, 'lunchOut', e.target.value)}
                                    className="w-full p-2 bg-white dark:bg-slate-900 border border-black/10 dark:border-white/10 rounded-xl text-center text-xs font-black text-slate-900 dark:text-white"
                                  />
                                </div>
                                <div className="space-y-1">
                                  <span className="text-[9px] font-black uppercase tracking-wider text-blue-600 block">Volta Almoço</span>
                                  <input
                                    type="time"
                                    value={day.lunchIn}
                                    onChange={e => handleUpdateDayField(day.dateStr, 'lunchIn', e.target.value)}
                                    className="w-full p-2 bg-white dark:bg-slate-900 border border-black/10 dark:border-white/10 rounded-xl text-center text-xs font-black text-slate-900 dark:text-white"
                                  />
                                </div>
                              </>
                            )}

                            <div className="space-y-1">
                              <span className="text-[9px] font-black uppercase tracking-wider text-rose-600 block">Saída</span>
                              <input
                                type="time"
                                value={day.checkOut}
                                onChange={e => handleUpdateDayField(day.dateStr, 'checkOut', e.target.value)}
                                className="w-full p-2 bg-white dark:bg-slate-900 border border-black/10 dark:border-white/10 rounded-xl text-center text-xs font-black text-slate-900 dark:text-white"
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* CARD 3: JUSTIFICATIVA & ENVIO */}
              <div className="p-6 md:p-8 bg-white dark:bg-slate-900 rounded-3xl border border-black/10 dark:border-white/10 space-y-6 shadow-xl">
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block ml-1">
                    Justificativa Geral do Período
                  </label>
                  <textarea
                    rows="3"
                    placeholder="Ex: Registro manual em folha física no início das atividades / regularização retroativa autorizada pela gestão..."
                    className="w-full p-4 bg-slate-50 dark:bg-black/40 border border-black/10 dark:border-white/10 rounded-2xl text-slate-900 dark:text-white font-medium text-sm outline-none focus:ring-2 focus:ring-indigo-500 placeholder:text-slate-400"
                    value={retroBatchReason}
                    onChange={e => setRetroBatchReason(e.target.value)}
                  />
                </div>

                <div className="p-4 bg-indigo-500/10 border border-indigo-500/20 rounded-2xl flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <ListChecks className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                    <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                      <strong>{retroDaysList.filter(d => d.selected).length}</strong> dia(s) selecionado(s) • Total de <strong>{retroDaysList.filter(d => d.selected).reduce((acc, d) => acc + (d.hasLunch ? 4 : 2), 0)}</strong> batidas
                    </span>
                  </div>
                  <span className="text-[10px] font-black uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                    Aprovação Unificada
                  </span>
                </div>

                <button
                  type="button"
                  onClick={handleSaveRetroBatch}
                  disabled={isSubmittingRetroBatch || retroDaysList.filter(d => d.selected).length === 0}
                  className="w-full py-5 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-black rounded-2xl shadow-xl shadow-indigo-600/30 transition-all active:scale-[0.98] uppercase tracking-widest text-xs flex items-center justify-center space-x-2 disabled:opacity-50"
                >
                  <Sparkles className="w-4 h-4" />
                  <span>
                    {isSubmittingRetroBatch
                      ? 'Enviando Lote para Aprovação...'
                      : `Enviar Período Completo (${retroDaysList.filter(d => d.selected).reduce((acc, d) => acc + (d.hasLunch ? 4 : 2), 0)} Batidas)`}
                  </span>
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSaveRetroDay} className="p-8 bg-white dark:bg-slate-900 rounded-3xl border border-black/10 dark:border-white/10 space-y-6 shadow-xl max-w-lg mx-auto">
              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block ml-1">Data do Ponto</label>
                <input
                  type="date"
                  min={employee?.retroactiveStart || undefined}
                  max={employee?.retroactiveEnd || undefined}
                  required
                  className="w-full p-4 bg-slate-50 dark:bg-black/40 border border-black/10 dark:border-white/10 rounded-2xl text-slate-900 dark:text-white font-black text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                  value={retroDayDate}
                  onChange={e => setRetroDayDate(e.target.value)}
                />
              </div>

              {/* Feedback inteligente quando o dia já possui a jornada principal registrada */}
              {singleDayRecords.some(r => r.type === 'check_in') && singleDayRecords.some(r => r.type === 'check_out') ? (
                <div className="p-4 bg-indigo-50/80 dark:bg-indigo-950/30 border border-indigo-500/20 rounded-2xl space-y-2">
                  <div className="flex items-center space-x-2 text-indigo-900 dark:text-indigo-200">
                    <Clock className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
                    <span className="font-black text-xs uppercase tracking-tight">Jornada Principal Já Registrada</span>
                  </div>
                  <p className="text-[11px] text-slate-600 dark:text-slate-300">
                    Este dia já possui entrada e saída principal:
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {singleDayRecords.map(r => (
                      <span key={r.id || r.timestamp} className="px-2 py-0.5 bg-indigo-100 dark:bg-white/10 text-indigo-900 dark:text-indigo-200 rounded-md text-[10px] font-bold">
                        {RECORD_TYPES[r.type]?.label || r.type}: {format(new Date(r.timestamp), 'HH:mm')}
                      </span>
                    ))}
                  </div>
                  <p className="text-[10px] text-indigo-600 dark:text-indigo-400 font-semibold pt-1">
                    Liberado exclusivamente para lançamento de <strong>Saída Extra</strong> e <strong>Retorno Extra</strong> (pausas/ausências intermediárias).
                  </p>
                </div>
              ) : null}

              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block ml-1">Tipo de Marcação</label>
                <select
                  value={retroDayType}
                  onChange={e => setRetroDayType(e.target.value)}
                  className="w-full p-4 bg-slate-50 dark:bg-black/40 border border-black/10 dark:border-white/10 rounded-2xl text-slate-900 dark:text-white font-bold text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  {singleDayRecords.some(r => r.type === 'check_in') && singleDayRecords.some(r => r.type === 'check_out') ? (
                    <>
                      <option value="other_out">Saída Extra (Ausência Intermediária)</option>
                      <option value="other_in">Retorno Extra (Retorno da Ausência)</option>
                    </>
                  ) : (
                    <>
                      <option value="check_in">Entrada Principal</option>
                      <option value="lunch_out">Saída Refeição (Almoço)</option>
                      <option value="lunch_in">Retorno Refeição (Almoço)</option>
                      <option value="check_out">Saída Definitiva</option>
                      <option value="other_out">Saída Extra</option>
                      <option value="other_in">Retorno Extra</option>
                    </>
                  )}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block ml-1">Horário Real em que Ocorreu</label>
                <input
                  type="time"
                  required
                  className="w-full p-4 bg-slate-50 dark:bg-black/40 border border-black/10 dark:border-white/10 rounded-2xl text-slate-900 dark:text-white font-black text-xl text-center outline-none focus:ring-2 focus:ring-indigo-500"
                  value={retroDayTime}
                  onChange={e => setRetroDayTime(e.target.value)}
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block ml-1">Justificativa / Motivo</label>
                <textarea
                  rows="3"
                  placeholder="Ex: Registro manual em folha física no início das atividades na empresa..."
                  className="w-full p-4 bg-slate-50 dark:bg-black/40 border border-black/10 dark:border-white/10 rounded-2xl text-slate-900 dark:text-white font-medium text-sm outline-none focus:ring-2 focus:ring-indigo-500 placeholder:text-slate-400"
                  value={retroDayReason}
                  onChange={e => setRetroDayReason(e.target.value)}
                />
              </div>

              <button
                type="submit"
                disabled={isSubmittingRetro}
                className="w-full py-5 bg-indigo-600 hover:bg-indigo-500 text-white font-black rounded-2xl shadow-xl shadow-indigo-600/30 transition-all active:scale-[0.98] uppercase tracking-widest text-xs flex items-center justify-center space-x-2 disabled:opacity-50"
              >
                <span>{isSubmittingRetro ? 'Enviando...' : 'Enviar para Aprovação do Administrador'}</span>
              </button>
            </form>
          )}
        </div>
      )}

      {step === 'history' && (
        <div className="w-full max-w-sm space-y-6 animate-in fade-in duration-300 pb-10">
          <div className="text-center space-y-2">
            <h2 className="text-2xl font-bold flex items-center justify-center"><FileText className="w-6 h-6 mr-2 text-blue-500" /> Histórico</h2>
            <p className="text-slate-500 dark:text-slate-400 text-sm">Selecione um ponto ou gere um extrato.</p>
          </div>

          {timeBank && (
            <div className={`p-5 rounded-3xl border shadow-lg space-y-3 ${timeBank.status === 'credit'
                ? 'bg-emerald-500/10 border-emerald-500/30'
                : timeBank.status === 'debt'
                  ? 'bg-red-500/10 border-red-500/30'
                  : 'bg-blue-500/10 border-blue-500/30'
              }`}>
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">Banco de Horas (Mês Atual)</span>
                <span className={`px-2.5 py-0.5 rounded-lg text-xs font-black font-mono ${timeBank.status === 'credit'
                    ? 'bg-emerald-500 text-white'
                    : timeBank.status === 'debt'
                      ? 'bg-red-500 text-white'
                      : 'bg-blue-500 text-white'
                  }`}>
                  {timeBank.balanceFormatted}
                </span>
              </div>
              <div className="flex flex-wrap justify-between gap-2 text-xs font-bold text-slate-700 dark:text-slate-300">
                <span>Trabalhadas: <b className="font-mono text-slate-900 dark:text-white">{timeBank.workedFormatted}</b></span>
                {timeBank.totalExcusedMin > 0 && (
                  <span className="text-teal-600 dark:text-teal-400">Abonadas: <b className="font-mono">+{timeBank.excusedFormatted}</b></span>
                )}
                <span>Previstas: <b className="font-mono text-slate-900 dark:text-white">{timeBank.expectedFormatted}</b></span>
              </div>
            </div>
          )}

          <div className="bg-white dark:bg-slate-900 p-5 rounded-3xl border border-black/10 dark:border-white/10 shadow-xl space-y-4">
            <h3 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-widest text-center">Gerar Extrato por Período</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider ml-1">Data Inicial</label>
                <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="w-full mt-1 p-3 bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-xl text-xs font-bold dark:text-white outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider ml-1">Data Final</label>
                <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="w-full mt-1 p-3 bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-xl text-xs font-bold dark:text-white outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>
            <button onClick={handleGenerateExtract} className="w-full py-4 bg-blue-600 hover:bg-blue-500 text-white font-black rounded-xl text-[10px] uppercase tracking-widest transition-all active:scale-[0.98] shadow-lg shadow-blue-500/20">
              Gerar Extrato Consolidado
            </button>
          </div>

          <div className="space-y-2">
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest ml-2">Comprovantes Individuais</h3>
            <div className="bg-white dark:bg-slate-900 rounded-3xl border border-black/10 dark:border-white/10 overflow-hidden shadow-xl max-h-[40vh] overflow-y-auto">
              {historyRecords.length === 0 ? (
                <div className="p-8 text-center text-slate-500">Nenhum registro encontrado.</div>
              ) : (
                <div className="divide-y divide-black/5 dark:divide-white/5">
                  {historyRecords.map((r, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        setSelectedTickets([r])
                        setShowQR(false)
                        setStep('ticket')
                      }}
                      className="w-full p-4 flex items-center justify-between hover:bg-black/5 dark:hover:bg-white/5 transition-colors text-left"
                    >
                      <div className="flex flex-col">
                        <span className="font-bold text-slate-900 dark:text-white text-sm">{RECORD_TYPES[r.type]?.label}</span>
                        <div className="flex items-center space-x-2">
                          <span className="text-xs text-slate-500">{format(new Date(r.timestamp), 'dd/MM/yyyy')}</span>
                          {r.comment && (
                            <span className="text-[10px] text-blue-500 italic truncate max-w-[120px] font-medium">({r.comment})</span>
                          )}
                          {['medico', 'esquecimento', 'retroactive_day'].includes(r.category) && (
                            <span className={`text-[9px] px-2 py-0.5 rounded-full font-bold uppercase ${r.status === 'pending' ? 'bg-orange-500/20 text-orange-500' :
                                r.status === 'approved' ? 'bg-emerald-500/20 text-emerald-500' :
                                  'bg-red-500/20 text-red-500'
                              }`}>
                              {r.status === 'pending' ? 'Pendente' : r.status === 'approved' ? 'Deferido' : 'Indeferido'}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center space-x-3">
                        <span className="font-mono text-blue-500 font-bold">{format(new Date(r.timestamp), 'HH:mm')}</span>
                        <FileText className="w-4 h-4 text-slate-400" />
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <button
            onClick={() => setStep('select')}
            className="w-full py-4 text-slate-500 hover:text-slate-900 dark:text-white text-xs font-bold uppercase tracking-widest transition-colors bg-black/5 dark:bg-white/5 rounded-2xl"
          >
            Voltar ao Início
          </button>
        </div>
      )}

      {step === 'ticket' && selectedTickets && selectedTickets.length > 0 && (
        <div className="w-full max-w-sm flex flex-col items-center space-y-6 animate-in slide-in-from-bottom-8 duration-500 pb-10">
          <div
            ref={ticketRef}
            className="w-72 bg-[#fef3c7] text-[#1e293b] p-6 shadow-2xl relative overflow-hidden"
            style={{ fontFamily: '"Courier New", Courier, monospace', borderTop: '4px dashed #cbd5e1', borderBottom: '4px dashed #cbd5e1' }}
          >
            {/* Marca d'água cruzada oficial de INDEFERIDO quando o registro for recusado */}
            {selectedTickets.length === 1 && selectedTickets[0].status === 'rejected' && (
              <div className="absolute inset-0 pointer-events-none flex items-center justify-center z-20 overflow-hidden">
                <div className="transform -rotate-45 border-4 border-dashed border-red-600/80 text-red-600/90 font-black text-2xl uppercase tracking-widest px-4 py-2 text-center select-none bg-red-100/60 backdrop-blur-[0.5px] shadow-sm">
                  INDEFERIDO
                  <span className="text-[8px] font-bold tracking-normal block mt-0.5 text-red-700 uppercase">
                    INVÁLIDO • PROCURE O RH
                  </span>
                </div>
              </div>
            )}

            <div className="text-center space-y-2 border-b border-dashed border-[#94a3b8] pb-4 mb-4">
              <h2 className="font-black text-lg tracking-tight uppercase leading-tight">{settings?.companyName || 'Empresa'}</h2>
              <p className="text-[10px] font-bold">{selectedTickets.length > 1 ? 'EXTRATO DE PONTO' : 'COMPROVANTE DE PONTO'}</p>
            </div>

            <div className="space-y-4 text-sm font-bold">
              <div>
                <p className="text-[#64748b] text-[10px] uppercase">Funcionário</p>
                <p className="truncate">{employee.name}</p>
              </div>

              {selectedTickets.length === 1 ? (
                <>
                  <div className="flex justify-between">
                    <div>
                      <p className="text-[#64748b] text-[10px] uppercase">Data</p>
                      <p>{format(new Date(selectedTickets[0].timestamp), 'dd/MM/yyyy')}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[#64748b] text-[10px] uppercase">Hora</p>
                      <p className="text-xl">{format(new Date(selectedTickets[0].timestamp), 'HH:mm')}</p>
                    </div>
                  </div>

                  <div>
                    <p className="text-[#64748b] text-[10px] uppercase">Registro</p>
                    <p>{RECORD_TYPES[selectedTickets[0].type]?.label}</p>
                    {selectedTickets[0].comment && (
                      <p className="text-[9px] text-[#64748b] italic mt-1 font-medium">Motivo declarado: {selectedTickets[0].comment}</p>
                    )}
                  </div>

                  {/* Informação destacada de Indeferimento dentro do comprovante */}
                  {selectedTickets[0].status === 'rejected' && (
                    <div className="p-3 bg-red-100/95 border-2 border-dashed border-red-500 rounded-lg text-red-900 text-[10px] space-y-1.5 my-2">
                      <p className="font-black text-xs flex items-center gap-1 text-red-700">
                        <span>⚠️ SOLICITAÇÃO INDEFERIDA (RECUSADA)</span>
                      </p>
                      {selectedTickets[0].rejectionReason && (
                        <p className="font-bold">Motivo: "{selectedTickets[0].rejectionReason}"</p>
                      )}
                      <p className="font-semibold leading-tight text-[9px] text-red-800">
                        Este lançamento não foi aceito como ponto oficial pela administração. Favor procurar o setor de Recursos Humanos (RH) para esclarecimentos e regularização.
                      </p>
                    </div>
                  )}

                  <div>
                    <p className="text-[#64748b] text-[10px] uppercase">Chave de Autenticação (Hash)</p>
                    <p className="text-xs break-all opacity-80">{new Date(selectedTickets[0].timestamp).getTime().toString(16).toUpperCase()}</p>
                  </div>
                </>
              ) : (
                <div className="space-y-3">
                  <div className="flex justify-between border-b border-dashed border-[#94a3b8] pb-1">
                    <p className="text-[#64748b] text-[10px] uppercase">Período</p>
                    <p className="text-xs">{format(new Date(startDate), 'dd/MM/yyyy')} a {format(new Date(endDate), 'dd/MM/yyyy')}</p>
                  </div>
                  <div className="space-y-2">
                    {selectedTickets.map((t, i) => (
                      <div key={i} className="flex justify-between items-start text-xs border-b border-[#cbd5e1]/50 pb-1 py-1">
                        <div className="flex flex-col text-left">
                          <div className="flex items-center space-x-2">
                            <span className="text-[#64748b] text-[9px]">{format(new Date(t.timestamp), 'dd/MM')}</span>
                            <span className="font-bold">{RECORD_TYPES[t.type]?.label}</span>
                          </div>
                          {t.comment && (
                            <div className="flex items-center space-x-2">
                              <span className="text-[8px] text-[#64748b] leading-tight italic max-w-[150px]">Motivo: {t.comment}</span>
                              {t.category === 'medico' && (
                                <span className="text-[7px] font-black uppercase opacity-70">
                                  [{t.status === 'pending' ? 'Pendente' : t.status === 'approved' ? 'Deferido' : 'Indeferido'}]
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                        <span className="font-black text-sm">{format(new Date(t.timestamp), 'HH:mm')}</span>
                      </div>
                    ))}
                  </div>
                  <div className="pt-2 flex justify-between items-center border-t border-dashed border-[#94a3b8] mt-2">
                    <p className="text-[#64748b] text-[10px] uppercase">Registros: {selectedTickets.length}</p>
                    <p className="text-lg font-black">{calculateTotalHours(selectedTickets)}</p>
                  </div>
                </div>
              )}
            </div>

            <div className="mt-6 pt-4 border-t border-dashed border-[#94a3b8] text-center">
              <p className="text-[9px] uppercase font-bold text-[#64748b]">Via do Trabalhador</p>
              <p className="text-[8px] text-[#94a3b8] mt-1">{selectedTickets.length > 1 ? 'Guarde este extrato' : 'Guarde este recibo'}</p>
            </div>
          </div>

          <div className="w-full space-y-3">
            {showQR ? (
              <div className="bg-white p-4 rounded-3xl flex flex-col items-center justify-center space-y-4 animate-in fade-in zoom-in shadow-2xl">
                <QRCodeSVG
                  value={
                    selectedTickets.length === 1
                      ? `whatsapp://send?text=${encodeURIComponent((selectedTickets[0].status === 'rejected' ? '❌ *[SOLICITAÇÃO INDEFERIDA - INVÁLIDO COMO PONTO OFICIAL]*\n⚠️ *Favor procurar o setor de RH.*\n\n' : '') + '*COMPROVANTE DE PONTO*\n\n🏢 *Empresa:* ' + (settings?.companyName || 'Empresa') + '\n👤 *Funcionário:* ' + employee.name + '\n📅 *Data:* ' + format(new Date(selectedTickets[0].timestamp), 'dd/MM/yyyy') + '\n⏰ *Hora:* ' + format(new Date(selectedTickets[0].timestamp), 'HH:mm') + '\n📝 *Registro:* ' + RECORD_TYPES[selectedTickets[0].type]?.label + (selectedTickets[0].status === 'rejected' ? '\n❌ *Status:* INDEFERIDO' : '') + '\n🔑 *Hash:* ' + new Date(selectedTickets[0].timestamp).getTime().toString(16).toUpperCase())}`
                      : `whatsapp://send?text=${encodeURIComponent('*EXTRATO DE PONTO*\n\n🏢 *Empresa:* ' + (settings?.companyName || 'Empresa') + '\n👤 *Funcionário:* ' + employee.name + '\n📅 *Período:* ' + format(new Date(startDate), 'dd/MM') + ' a ' + format(new Date(endDate), 'dd/MM') + '\n⏱️ *Total:* ' + calculateTotalHours(selectedTickets) + '\n\n' + selectedTickets.map(t => '• ' + format(new Date(t.timestamp), 'dd/MM HH:mm') + ' - ' + RECORD_TYPES[t.type]?.label.split(' ')[0] + (t.status === 'rejected' ? ' [INDEFERIDO]' : '')).join('\n'))}`
                  }
                  size={200}
                />
                <p className="text-xs font-bold text-slate-500 text-center">Abra a câmera do celular<br />e aponte para o código.</p>
                <button onClick={() => setShowQR(false)} className="text-[10px] font-black uppercase text-blue-500 p-2 hover:bg-blue-50 rounded-lg">Voltar aos botões</button>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={downloadTicketPNG}
                  className="py-4 bg-blue-600 hover:bg-blue-500 text-white font-black rounded-2xl transition-all active:scale-[0.98] uppercase tracking-widest text-[10px] flex flex-col items-center justify-center space-y-1 shadow-lg shadow-blue-500/20"
                >
                  <Download className="w-5 h-5" />
                  <span>Salvar Imagem</span>
                </button>
                <button
                  onClick={() => setShowQR(true)}
                  className="py-4 bg-emerald-600 hover:bg-emerald-500 text-white font-black rounded-2xl transition-all active:scale-[0.98] uppercase tracking-widest text-[10px] flex flex-col items-center justify-center space-y-1 shadow-lg shadow-emerald-500/20"
                >
                  <QrCode className="w-5 h-5" />
                  <span>Ler com Celular</span>
                </button>
                <button
                  onClick={sendEmail}
                  className="col-span-2 py-4 bg-white dark:bg-slate-900 border border-black/10 dark:border-white/10 text-slate-900 dark:text-white font-black rounded-2xl transition-all active:scale-[0.98] uppercase tracking-widest text-[10px] flex items-center justify-center space-x-3 shadow-xl"
                >
                  <Mail className="w-5 h-5 text-blue-500" />
                  <span>{employee.email ? `Enviar p/ ${employee.email}` : 'Enviar por E-mail'}</span>
                </button>
              </div>
            )}

            <button
              onClick={() => setStep('history')}
              className="w-full py-4 text-slate-500 hover:text-slate-900 dark:text-white text-xs font-bold uppercase tracking-widest transition-colors"
            >
              Voltar ao Histórico
            </button>
          </div>
        </div>
      )}

      {/* Modal de Feedback Customizado do Sistema (substitui alerts nativos do navegador) */}
      {feedbackModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-in fade-in duration-200">
          <div className="bg-white/95 dark:bg-slate-900/95 backdrop-blur-2xl border border-slate-200/80 dark:border-white/10 p-6 md:p-8 rounded-[2.5rem] shadow-2xl max-w-sm w-full text-center space-y-5 transform transition-all animate-in zoom-in-95 duration-200">
            <div className="flex justify-center">
              <div className={`w-16 h-16 rounded-2xl flex items-center justify-center border shadow-lg ${feedbackModal.type === 'success'
                  ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20 shadow-emerald-500/10'
                  : feedbackModal.type === 'warning'
                    ? 'bg-amber-500/10 text-amber-500 border-amber-500/20 shadow-amber-500/10'
                    : feedbackModal.type === 'error'
                      ? 'bg-rose-500/10 text-rose-500 border-rose-500/20 shadow-rose-500/10'
                      : 'bg-blue-500/10 text-blue-500 border-blue-500/20 shadow-blue-500/10'
                }`}>
                {feedbackModal.type === 'success' && <CheckCircle2 className="w-8 h-8" />}
                {feedbackModal.type === 'warning' && <ShieldAlert className="w-8 h-8" />}
                {feedbackModal.type === 'error' && <AlertCircle className="w-8 h-8" />}
                {feedbackModal.type === 'info' && <Info className="w-8 h-8" />}
              </div>
            </div>

            <div className="space-y-2">
              <h3 className="text-base md:text-lg font-black text-slate-900 dark:text-white tracking-tight">
                {feedbackModal.title || 'Aviso do Sistema'}
              </h3>
              <p className="text-xs md:text-sm font-medium text-slate-600 dark:text-slate-300 leading-relaxed">
                {feedbackModal.message}
              </p>
            </div>

            <button
              onClick={() => {
                const cb = feedbackModal.onConfirm
                setFeedbackModal(null)
                if (cb) cb()
              }}
              className="w-full py-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-black rounded-2xl shadow-xl shadow-blue-500/25 active:scale-[0.98] transition-all text-xs uppercase tracking-widest"
            >
              Entendido
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
