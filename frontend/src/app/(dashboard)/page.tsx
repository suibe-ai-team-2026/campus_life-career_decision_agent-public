'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AppShell } from '@/components/layout/AppShell'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Flame,
  Upload,
  FileText,
  Video,
  Music,
  ChevronRight,
  TrendingUp,
  Layers,
  Zap,
} from 'lucide-react'

// Mock data — will be replaced by API hooks
const recentDocs = [
  { id: 'doc-kaoyan-math', type: 'pdf', title: '考研数学一·真题精讲（2018-2024）', subject: '数学一', pages: 412, progress: 0.34, indexed: true },
  { id: 'doc-mzdsz', type: 'pdf', title: '毛中特·重点章节梳理', subject: '政治', pages: 168, progress: 0.62, indexed: true },
  { id: 'vid-zhuanglie', type: 'video', title: '张老师·线性代数串讲', subject: '数学一', duration: '2:37:00', progress: 0.41, indexed: true },
  { id: 'doc-gongka-shenlun', type: 'pdf', title: '国考申论·5年范文 + 阅卷标准', subject: '申论', pages: 96, progress: 0.18, indexed: true },
  { id: 'vid-shizheng', type: 'video', title: '2025 时政热点 · 二十届三中全会', subject: '政治', duration: '1:36:00', progress: 0.08, indexed: false },
]

const EXAM_DATE = new Date('2026-12-19T00:00:00+08:00')
const MS_PER_DAY = 24 * 60 * 60 * 1000

export default function DashboardPage() {
  const router = useRouter()
  const [checkedIn, setCheckedIn] = useState(false)
  const daysUntilExam = useMemo(
    () => Math.max(0, Math.ceil((EXAM_DATE.getTime() - Date.now()) / MS_PER_DAY)),
    []
  )
  const weekDays = useMemo(() => buildWeekDays(checkedIn), [checkedIn])

  const handleCheckin = () => setCheckedIn(true)

  return (
    <AppShell>
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto p-6 space-y-6">
          {/* Greeting + Exam Countdown */}
          <div>
            <h1 className="text-2xl font-bold">
              下午好，<span className="text-primary">子衿</span>。
            </h1>
            <p className="text-muted-foreground mt-1">
              距离 <em className="not-italic text-primary/80">2027 考研初试预计日期</em> 还剩{' '}
              <em className="not-italic text-foreground font-semibold">{daysUntilExam}</em> 天 · 今天计划{' '}
              <em className="not-italic text-foreground font-semibold">3.5h</em>
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {/* Left column: Upload + Recent */}
            <div className="lg:col-span-2 space-y-5">
              {/* Upload card */}
              <Card className="border-dashed border-2 hover:border-primary/50 transition-colors cursor-pointer"
                    onClick={() => router.push('/sources')}>
                <CardContent className="p-6 text-center space-y-3">
                  <Upload className="h-8 w-8 mx-auto text-muted-foreground" />
                  <div>
                    <div className="text-lg font-semibold">上传 PDF / 长视频 / 录音</div>
                    <div className="text-sm text-muted-foreground">
                      拖拽到此处，或点击选择文件 · 单文件 ≤ 200MB
                    </div>
                  </div>
                  <div className="flex gap-2 justify-center flex-wrap">
                    {['PDF', 'DOCX', 'MP4', 'MOV', 'MP3', 'WAV', 'JPG'].map(t => (
                      <Badge key={t} variant="secondary" className="text-xs">{t}</Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* Recent documents */}
              <Card>
                <CardContent className="p-4">
                  <h3 className="font-semibold mb-3 flex items-center gap-2">
                    <Layers className="h-4 w-4 text-primary" />
                    最近打开
                    <Badge variant="secondary" className="ml-1">{recentDocs.length}</Badge>
                  </h3>
                  <div className="space-y-1">
                    {recentDocs.map(doc => (
                      <div key={doc.id}
                           className="flex items-center gap-3 p-3 rounded-lg hover:bg-secondary transition-colors cursor-pointer group"
                           onClick={() => router.push(doc.type === 'pdf' ? `/notebooks/${doc.id}` : `/notebooks/${doc.id}`)}>
                        <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center flex-shrink-0">
                          {doc.type === 'pdf' ? <FileText className="h-5 w-5 text-primary" /> :
                           doc.type === 'video' ? <Video className="h-5 w-5 text-primary" /> :
                           <Music className="h-5 w-5 text-primary" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">{doc.title}</div>
                          <div className="text-xs text-muted-foreground">
                            {doc.subject} · {doc.type === 'pdf' ? `${doc.pages} 页` : doc.duration}
                            {!doc.indexed && <span className="text-amber-400 ml-2">● 索引中…</span>}
                          </div>
                        </div>
                        <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden flex-shrink-0">
                          <div className="h-full bg-primary rounded-full transition-all"
                               style={{ width: `${Math.round(doc.progress * 100)}%` }} />
                        </div>
                        <span className="text-xs text-muted-foreground w-8 text-right">
                          {Math.round(doc.progress * 100)}%
                        </span>
                        <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Right column: Check-in + Flashcards + Metrics */}
            <div className="space-y-5">
              {/* Check-in streak */}
              <Card>
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <Flame className="h-5 w-5 text-primary" />
                    <h4 className="font-semibold">
                      已连续学习 <span className="text-primary">4</span> 天
                    </h4>
                    <span className="text-xs text-muted-foreground ml-auto">+2 经验/日</span>
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
                    variant={checkedIn ? 'secondary' : 'default'}
                    disabled={checkedIn}
                    onClick={handleCheckin}
                  >
                    {checkedIn ? '✓ 今日已签到' : '今日签到 +2 经验'}
                  </Button>
                </CardContent>
              </Card>

              {/* Flashcard preview */}
              <Card>
                <CardContent className="p-4 space-y-3">
                  <h4 className="font-semibold flex items-center gap-2">
                    <Zap className="h-4 w-4 text-primary" />
                    闪卡复习
                    <Badge variant="secondary" className="ml-1">12 待复习</Badge>
                  </h4>
                  <div className="flex justify-between text-center">
                    <div>
                      <div className="text-lg font-bold text-amber-400">12</div>
                      <div className="text-xs text-muted-foreground">待复习</div>
                    </div>
                    <div>
                      <div className="text-lg font-bold">48</div>
                      <div className="text-xs text-muted-foreground">学习中</div>
                    </div>
                    <div>
                      <div className="text-lg font-bold">134</div>
                      <div className="text-xs text-muted-foreground">已掌握</div>
                    </div>
                  </div>
                  <Button variant="outline" className="w-full" onClick={() => router.push('/flashcards')}>
                    开始今日复习 →
                  </Button>
                </CardContent>
              </Card>

              {/* Weekly metrics */}
              <Card>
                <CardContent className="p-4 space-y-3">
                  <h4 className="font-semibold flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-primary" />
                    本周指标
                  </h4>
                  <div className="space-y-2.5">
                    <Metric label="学习时长" value="14h 22m" hint="+18% 较上周" />
                    <Metric label="新增笔记" value="38 段" hint="3 篇文档" />
                    <Metric label="AI 提问" value="124 次" hint="平均 3.7s 响应" />
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

function buildWeekDays(checkedIn: boolean) {
  const labels = ['一', '二', '三', '四', '五', '六', '日']
  const now = new Date()
  const todayIndex = (now.getDay() + 6) % 7
  const monday = new Date(now)
  monday.setHours(0, 0, 0, 0)
  monday.setDate(now.getDate() - todayIndex)

  return labels.map((day, index) => {
    const current = new Date(monday)
    current.setDate(monday.getDate() + index)

    return {
      day,
      date: String(current.getDate()),
      today: index === todayIndex,
      done: index < todayIndex || (index === todayIndex && checkedIn),
    }
  })
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
