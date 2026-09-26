import { format, startOfMonth, endOfMonth, isBefore, isSameDay } from 'date-fns'
import { calculateNetShiftTime, checkEmployeeWorkDay, isNationalOrCustomHoliday } from './shiftUtils'

/**
 * Formata minutos em texto amigável (ex: "8h 30m" ou "+2h 15m")
 */
export function formatMinutesToHours(minutes, showSign = false) {
  if (minutes === 0 || isNaN(minutes)) {
    return showSign ? '+0h 00m' : '0h 00m'
  }
  const isNegative = minutes < 0
  const abs = Math.abs(minutes)
  const h = Math.floor(abs / 60)
  const m = Math.round(abs % 60)
  const mStr = m.toString().padStart(2, '0')
  
  if (isNegative) {
    return `-${h}h ${mStr}m`
  }
  return `${showSign ? '+' : ''}${h}h ${mStr}m`
}

/**
 * Calcula os minutos trabalhados em um único dia com suporte a jornada ao vivo
 */
export function calculateDayWorkedMinutes(dayRecords = [], isToday = false) {
  const valid = dayRecords
    .filter(r => r.status !== 'rejected' && r.type !== 'superseded')
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))

  let totalMs = 0
  let isWorking = false
  let lastStart = null
  let hasExcused = valid.some(r => ['admin_excused', 'admin_abonada', 'admin_vacation'].includes(r.type))
  let hasAbonada = valid.some(r => r.type === 'admin_abonada')
  let hasMedical = valid.some(r => r.type === 'admin_excused')
  let hasVacation = valid.some(r => r.type === 'admin_vacation')
  let hasAbsence = valid.some(r => r.type === 'admin_absence')

  let partialAbonoMin = 0

  valid.forEach(r => {
    if (r.type === 'admin_partial_abono') {
      partialAbonoMin += (Number(r.abonoMinutes) || 0)
    }
    if (['check_in', 'lunch_in', 'other_in'].includes(r.type)) {
      if (!isWorking) {
        isWorking = true
        lastStart = new Date(r.timestamp)
      }
    } else if (['lunch_out', 'other_out', 'check_out', 'system_auto_checkout', 'admin_adjustment'].includes(r.type)) {
      if (isWorking) {
        isWorking = false
        totalMs += (new Date(r.timestamp) - lastStart)
      }
    }
  })

  // Se o colaborador ainda estiver trabalhando hoje, soma o tempo em andamento
  if (isWorking && isToday) {
    totalMs += (new Date() - lastStart)
  }

  const workedMin = Math.round(totalMs / 60000)

  return {
    workedMin,
    partialAbonoMin,
    isWorking,
    hasExcused,
    hasAbonada,
    hasMedical,
    hasVacation,
    hasAbsence,
    recordsCount: valid.length
  }
}

/**
 * Calcula em tempo real o saldo de banco de horas / horas extras de um colaborador
 * no mês especificado (ou mês atual até o dia de hoje).
 */
export function calculateEmployeeMonthBalance(emp, allRecords = [], holidays = [], targetMonthStr = format(new Date(), 'yyyy-MM')) {
  if (!emp) return null

  const [year, month] = targetMonthStr.split('-').map(Number)
  const monthDate = new Date(year, month - 1, 1, 12, 0, 0)
  const monthStart = startOfMonth(monthDate)
  const monthEnd = endOfMonth(monthDate)
  const today = new Date()
  const currentMonthStr = format(today, 'yyyy-MM')
  const isCurrentMonth = targetMonthStr === currentMonthStr

  const netShift = calculateNetShiftTime(
    emp.shiftStart || '08:00',
    emp.lunchStart || '12:00',
    emp.lunchEnd || '13:00',
    emp.shiftEnd || '17:00'
  )
  const dailyExpectedMin = netShift.dailyMin || 480

  const daysInMonth = monthEnd.getDate()
  let totalExpectedMin = 0
  let totalWorkedMin = 0
  let totalExcusedMin = 0
  let isCurrentlyWorking = false
  let workedDaysCount = 0
  let absenceDaysCount = 0
  let excusedDaysCount = 0
  let abonadaDaysCount = 0
  let medicalDaysCount = 0
  let vacationDaysCount = 0

  // Filtra registros do colaborador no mês selecionado
  const empRecords = allRecords.filter(r => {
    if (r.employeeId !== emp.id) return false
    const d = new Date(r.timestamp)
    return d >= monthStart && d <= monthEnd
  })

  // Agrupa registros por data ISO (yyyy-MM-dd)
  const recordsByDay = {}
  empRecords.forEach(r => {
    const dayKey = format(new Date(r.timestamp), 'yyyy-MM-dd')
    if (!recordsByDay[dayKey]) recordsByDay[dayKey] = []
    recordsByDay[dayKey].push(r)
  })

  for (let i = 1; i <= daysInMonth; i++) {
    const d = new Date(year, month - 1, i, 12, 0, 0)
    const dateISO = format(d, 'yyyy-MM-dd')
    const isToday = isSameDay(d, today)

    // Se o mês for o mês atual, não contabiliza dias futuros como falta/débito
    if (isCurrentMonth && d > today && !isToday) {
      continue
    }

    const holiday = isNationalOrCustomHoliday(dateISO, holidays)
    const workDayStatus = checkEmployeeWorkDay(emp, d)
    const isScheduledWorkDay = workDayStatus.isWorkDay && !holiday
    const isSunday = d.getDay() === 0

    const dayRecords = recordsByDay[dateISO] || []
    const dayCalc = calculateDayWorkedMinutes(dayRecords, isToday)

    if (dayCalc.isWorking && isToday) {
      isCurrentlyWorking = true
    }

    if (dayCalc.hasExcused) {
      // Dia justificado (falta abonada, atestado médico, férias):
      // Registra a contagem e horas abonadas correspondentes à jornada do dia para não haver desconto salarial
      excusedDaysCount++
      if (dayCalc.hasAbonada) abonadaDaysCount++
      if (dayCalc.hasMedical) medicalDaysCount++
      if (dayCalc.hasVacation) vacationDaysCount++

      if (isScheduledWorkDay) {
        totalExpectedMin += dailyExpectedMin
        totalExcusedMin += dailyExpectedMin
      }
    } else if (isScheduledWorkDay) {
      totalExpectedMin += dailyExpectedMin
      if (dayCalc.workedMin === 0 && dayCalc.partialAbonoMin === 0 && !isToday) {
        absenceDaysCount++
      }
    }

    // Abono parcial de horas para compensação de saídas antecipadas, atrasos ou dispensas parciais
    if (dayCalc.partialAbonoMin > 0 && !dayCalc.hasExcused) {
      totalExcusedMin += dayCalc.partialAbonoMin
    }

    let workedMin = dayCalc.workedMin
    if (workedMin > 0) {
      workedDaysCount++
      // Multiplicador de 2.0x (100% de hora extra CLT) para trabalho em feriados ou domingos
      if (holiday || (isSunday && !workDayStatus.isWorkDay)) {
        workedMin = Math.round(workedMin * 2.0)
      }
    }

    totalWorkedMin += workedMin
  }

  // O tempo abonado compensa a meta prevista para que faltas abonadas/justificadas não gerem débito
  const balanceMin = (totalWorkedMin + totalExcusedMin) - totalExpectedMin
  const overtimeMin = Math.max(0, balanceMin)
  const debtMin = Math.max(0, -balanceMin)

  let status = 'neutral'
  if (balanceMin > 0) status = 'credit'      // "Horas na Casa" / Positivo
  else if (balanceMin < 0) status = 'debt'  // "Devendo Horas" / Negativo

  return {
    employeeId: emp.id,
    employeeName: emp.name,
    departmentId: emp.departmentId,
    regime: emp.workRegime,
    targetMonth: targetMonthStr,
    totalExpectedMin,
    totalWorkedMin,
    totalExcusedMin,
    balanceMin,
    overtimeMin,
    debtMin,
    status,
    isCurrentlyWorking,
    workedDaysCount,
    absenceDaysCount,
    excusedDaysCount,
    abonadaDaysCount,
    medicalDaysCount,
    vacationDaysCount,
    expectedFormatted: formatMinutesToHours(totalExpectedMin),
    workedFormatted: formatMinutesToHours(totalWorkedMin),
    excusedFormatted: formatMinutesToHours(totalExcusedMin),
    balanceFormatted: formatMinutesToHours(balanceMin, true),
    overtimeFormatted: formatMinutesToHours(overtimeMin),
    debtFormatted: formatMinutesToHours(debtMin)
  }
}

/**
 * Calcula o consolidado da empresa inteira para o RH no mês selecionado
 */
export function calculateCompanyMonthBalance(employees = [], allRecords = [], holidays = [], targetMonthStr = format(new Date(), 'yyyy-MM')) {
  const employeeBalances = employees.map(emp => {
    return calculateEmployeeMonthBalance(emp, allRecords, holidays, targetMonthStr)
  }).filter(Boolean)

  let totalCompanyWorkedMin = 0
  let totalCompanyExpectedMin = 0
  let totalCompanyExcusedMin = 0
  let totalOvertimeMin = 0
  let totalDebtMin = 0
  let creditCount = 0
  let debtCount = 0
  let evenCount = 0
  let activeWorkersCount = 0

  employeeBalances.forEach(b => {
    totalCompanyWorkedMin += b.totalWorkedMin
    totalCompanyExpectedMin += b.totalExpectedMin
    totalCompanyExcusedMin += (b.totalExcusedMin || 0)
    totalOvertimeMin += b.overtimeMin
    totalDebtMin += b.debtMin
    if (b.status === 'credit') creditCount++
    else if (b.status === 'debt') debtCount++
    else evenCount++
    if (b.isCurrentlyWorking) activeWorkersCount++
  })

  const companyNetBalanceMin = (totalCompanyWorkedMin + totalCompanyExcusedMin) - totalCompanyExpectedMin

  return {
    targetMonth: targetMonthStr,
    totalEmployees: employees.length,
    activeWorkersCount,
    totalCompanyWorkedMin,
    totalCompanyExpectedMin,
    totalCompanyExcusedMin,
    totalOvertimeMin,
    totalDebtMin,
    companyNetBalanceMin,
    creditCount,
    debtCount,
    evenCount,
    companyNetFormatted: formatMinutesToHours(companyNetBalanceMin, true),
    totalOvertimeFormatted: formatMinutesToHours(totalOvertimeMin),
    totalDebtFormatted: formatMinutesToHours(totalDebtMin),
    totalWorkedFormatted: formatMinutesToHours(totalCompanyWorkedMin),
    totalExpectedFormatted: formatMinutesToHours(totalCompanyExpectedMin),
    totalExcusedFormatted: formatMinutesToHours(totalCompanyExcusedMin),
    employeeBalances
  }
}
