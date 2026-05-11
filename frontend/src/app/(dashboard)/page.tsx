'use client'

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import {
  ChevronRight,
  FileText,
  Flame,
  Layers,
  Music,
  TrendingUp,
  Upload,
  Video,
  Zap,
} from 'lucide-react'

import { sourcesApi } from '@/lib/api/sources'
import { useCheckin, useFlashcardDecks, useStudyMetrics, useStudyStreak } from '@/lib/hooks/use-genote'
import { SourceListResponse } from '@/lib/types/api'
import { AppShell } from '@/components/layout/AppShell'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

const EXAM_DATE = new Date('2026-12-19T00:00:00+08:00')
const MS_PER_DAY = 24 * 60 * 60 * 1000

export default function DashboardPage() {
  const router = useRouter()
  const { data: recentSources = [], isLoading: sourcesLoading } = useQuery({
    queryKey: ['dashboard', 'recent-sources'],
    queryFn: () => sourcesApi.list({ limit: 5, offset: 0, sort_by: 'updated', sort_order: 'desc' }),
  })
  const { data: streak } = useStudyStreak()
  const { data: metrics } = useStudyMetrics()
  const { data: decks = [] } = useFlashcardDecks()
  const checkin = useCheckin()

  const daysUntilExam = useMemo(
    () => Math.max(0, Math.ceil((EXAM_DATE.getTime() - Date.now()) / MS_PER_DAY)),
    []
  )
  const weekDays = useMemo(
    () => buildWeekDays(streak?.streak_days ?? 0, streak?.checked_in_today ?? false),
    [streak?.checked_in_today, streak?.streak_days]
  )
  const dueCards = decks.reduce((sum, deck) => sum + deck.due_count, 0)
  const totalCards = decks.reduce((sum, deck) => sum + deck.card_count, 0)

  return (
    <AppShell>
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto p-6 space-y-6">
          <div>
            <h1 className="text-2xl font-bold">
              下午好，<span className="text-primary">子衿</span>。
            </h1>
            <p className="text-muted-foreground mt-1">
              距离 <em className="not-italic text-primary/80">2027 考研初试预计日期</em> 还剩{' '}
              <em className="not-italic text-foreground font-semibold">{daysUntilExam}</em> 天
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <div className="lg:col-span-2 space-y-5">
              <Card className="border-dashed border-2 hover:border-primary/50 transition-colors cursor-pointer"
                    onClick={() => router.push('/sources')}>
                <CardContent className="p-6 text-center space-y-3">
                  <Upload className="h-8 w-8 mx-auto text-muted-foreground" />
                  <div>
                    <div className="text-lg font-semibold">上传 PDF / 长视频 / 录音</div>
                    <div className="text-sm text-muted-foreground">
                      拖拽到此处，或点击选择文件
                    </div>
                  </div>
                  <div className="flex gap-2 justify-center flex-wrap">
                    {['PDF', 'DOCX', 'MP4', 'MOV', 'MP3', 'WAV', 'JPG'].map(t => (
                      <Badge key={t} variant="secondary" className="text-xs">{t}</Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-4">
                  <h3 className="font-semibold mb-3 flex items-center gap-2">
                    <Layers className="h-4 w-4 text-primary" />
                    最近打开
                    <Badge variant="secondary" className="ml-1">{recentSources.length}</Badge>
                  </h3>
                  {sourcesLoading ? (
                    <div className="flex justify-center py-8">
                      <LoadingSpinner />
                    </div>
                  ) : recentSources.length === 0 ? (
                    <div className="text-sm text-muted-foreground py-8 text-center">
                      上传第一份资料后，这里会显示最近学习内容。
                    </div>
                  ) : (
                    <div className="space-y-1">
                      {recentSources.map(source => (
                        <SourceRow
                          key={source.id}
                          source={source}
                          onOpen={() => router.push(`/sources/${encodeURIComponent(source.id)}`)}
                        />
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            <div className="space-y-5">
              <Card>
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <Flame className="h-5 w-5 text-primary" />
                    <h4 className="font-semibold">
                      已连续学习 <span className="text-primary">{streak?.streak_days ?? 0}</span> 天
                    </h4>
                    <span className="text-xs text-muted-foreground ml-auto">
                      {streak?.total_xp ?? 0} XP
                    </span>
                  </div>
                  <div className="grid grid-cols-7 gap-1">
                    {weekDays.map((d, i) => (
                      <div key={i}
                           title={d.day}
                           className={`text-center py-1.5 rounded text-xs font-medium ${
                             d.done ? 'bg-primary/20 text-primary' :
                             d.today ? 'bg-primary/10 text-primary ring-1 ring-primary/50' :
                             'bg-muted text-muted-foreground'
                           }`}>
                        {d.date}
                      </div>
                    ))}
                  </div>
                  <Button
                    className="w-full"
                    variant={streak?.checked_in_today ? 'secondary' : 'default'}
                    disabled={Boolean(streak?.checked_in_today) || checkin.isPending}
                    onClick={() => checkin.mutate()}
                  >
                    {streak?.checked_in_today ? '今日已签到' : '今日签到 +2 经验'}
                  </Button>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-4 space-y-3">
                  <h4 className="font-semibold flex items-center gap-2">
                    <Zap className="h-4 w-4 text-primary" />
                    闪卡复习
                    <Badge variant="secondary" className="ml-1">{dueCards} 待复习</Badge>
                  </h4>
                  <div className="flex justify-between text-center">
                    <Stat value={dueCards} label="待复习" highlight />
                    <Stat value={totalCards} label="总卡片" />
                    <Stat value={decks.length} label="卡组" />
                  </div>
                  <Button variant="outline" className="w-full" onClick={() => router.push('/flashcards')}>
                    开始今日复习
                  </Button>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-4 space-y-3">
                  <h4 className="font-semibold flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-primary" />
                    本周指标
                  </h4>
                  <div className="space-y-2.5">
                    <Metric
                      label="学习时长"
                      value={formatHours(metrics?.total_hours ?? 0)}
                      hint={`${formatPct(metrics?.hours_change_pct ?? 0)} 较上周`}
                    />
                    <Metric label="新增笔记" value={`${metrics?.new_notes ?? 0} 段`} hint="本周创建" />
                    <Metric
                      label="AI 提问"
                      value={`${metrics?.ai_questions ?? 0} 次`}
                      hint={`平均 ${formatSeconds(metrics?.avg_response_time ?? 0)} 响应`}
                    />
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  )
}

function SourceRow({ source, onOpen }: { source: SourceListResponse; onOpen: () => void }) {
  const kind = getSourceKind(source)
  const progress = getIndexProgress(source)
  const Icon = kind === 'video' ? Video : kind === 'audio' ? Music : FileText

  return (
    <div
      className="flex items-center gap-3 p-3 rounded-lg hover:bg-secondary transition-colors cursor-pointer group"
      onClick={onOpen}
    >
      <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center flex-shrink-0">
        <Icon className="h-5 w-5 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-medium truncate">{source.title || '未命名资料'}</div>
        <div className="text-xs text-muted-foreground">
          {kindLabel(kind)} · {source.embedded ? '已索引' : source.status || '待索引'}
        </div>
      </div>
      <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden flex-shrink-0">
        <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${progress}%` }} />
      </div>
      <span className="text-xs text-muted-foreground w-8 text-right">{progress}%</span>
      <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
    </div>
  )
}

function Stat({ value, label, highlight = false }: { value: number; label: string; highlight?: boolean }) {
  return (
    <div>
      <div className={`text-lg font-bold ${highlight ? 'text-amber-400' : ''}`}>{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  )
}

function buildWeekDays(streakDays: number, checkedInToday: boolean) {
  const labels = ['一', '二', '三', '四', '五', '六', '日']
  const now = new Date()
  const todayIndex = (now.getDay() + 6) % 7
  const monday = new Date(now)
  monday.setHours(0, 0, 0, 0)
  monday.setDate(now.getDate() - todayIndex)

  return labels.map((day, index) => {
    const current = new Date(monday)
    current.setDate(monday.getDate() + index)
    const daysFromToday = Math.floor((startOfDay(now).getTime() - current.getTime()) / MS_PER_DAY)
    const done = daysFromToday >= 0 && daysFromToday < streakDays && (daysFromToday > 0 || checkedInToday)

    return {
      day,
      date: String(current.getDate()),
      today: index === todayIndex,
      done,
    }
  })
}

function startOfDay(value: Date) {
  const date = new Date(value)
  date.setHours(0, 0, 0, 0)
  return date
}

function getSourceKind(source: SourceListResponse): 'pdf' | 'video' | 'audio' | 'link' | 'text' {
  const filePath = source.asset?.file_path?.toLowerCase() ?? ''
  const url = source.asset?.url
  if (/\.(mp4|mov|m4v|webm)$/.test(filePath)) return 'video'
  if (/\.(mp3|wav|m4a|aac|flac)$/.test(filePath)) return 'audio'
  if (filePath) return 'pdf'
  if (url) return 'link'
  return 'text'
}

function kindLabel(kind: ReturnType<typeof getSourceKind>) {
  return {
    pdf: '文档',
    video: '视频',
    audio: '音频',
    link: '网页',
    text: '文本',
  }[kind]
}

function getIndexProgress(source: SourceListResponse) {
  if (source.embedded) return 100
  if (source.status === 'failed') return 0
  if (source.embedded_chunks > 0) return 80
  if (source.command_id || source.status) return 45
  return 0
}

function formatHours(hours: number) {
  const wholeHours = Math.floor(hours)
  const minutes = Math.round((hours - wholeHours) * 60)
  return minutes > 0 ? `${wholeHours}h ${minutes}m` : `${wholeHours}h`
}

function formatPct(value: number) {
  return `${value >= 0 ? '+' : ''}${value}%`
}

function formatSeconds(value: number) {
  return `${value.toFixed(1)}s`
}

function Metric({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="flex items-baseline justify-between border-b border-border/50 pb-2 last:border-0 last:pb-0">
      <div>
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-[10px] text-muted-foreground/60 font-mono">{hint}</div>
      </div>
      <div className="text-lg font-semibold font-mono">{value}</div>
    </div>
  )
}
