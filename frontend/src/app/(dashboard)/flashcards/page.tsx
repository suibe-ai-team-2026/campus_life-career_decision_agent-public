'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { AppShell } from '@/components/layout/AppShell'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { ArrowLeft, Zap, FileText } from 'lucide-react'

interface Flashcard {
  id: string
  q: string
  a: string
  src: string
  next: string
}

const mockCards: Flashcard[] = [
  {
    id: 'fc1',
    q: '特征值与特征向量的定义条件中，必须满足的三个关键点是什么？',
    a: '（1）A 必须是 n 阶方阵；（2）特征向量 x 必须是非零向量；（3）特征值 λ 可以为 0，但 x 不能为零向量。',
    src: '考研数学一 · p.80',
    next: '明天',
  },
  {
    id: 'fc2',
    q: 'n 阶方阵 A 可对角化的充要条件是什么？',
    a: 'A 有 n 个线性无关的特征向量。等价表述：每一个 k 重特征值恰好对应 k 个线性无关的特征向量。',
    src: '考研数学一 · p.94',
    next: '3 天后',
  },
  {
    id: 'fc3',
    q: '已知 3 阶矩阵 A 的特征值为 1, -1, 2。求 |A + 2E|。',
    a: 'A + 2E 的特征值为 3, 1, 4。|A + 2E| = 3 × 1 × 4 = 12。\n\n核心：A 与 f(A) 共享特征向量；A 的特征值代入 f 即得 f(A) 的特征值。',
    src: '线代串讲 · 04:36',
    next: '明天',
  },
]

export default function FlashcardsPage() {
  const router = useRouter()
  const [idx, setIdx] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [done, setDone] = useState(false)

  const card = mockCards[idx]

  if (done || !card) {
    return (
      <AppShell>
        <div className="flex-1 flex items-center justify-center">
          <Card className="w-full max-w-md text-center p-8 space-y-4">
            <Zap className="h-12 w-12 mx-auto text-primary" />
            <div>
              <div className="text-2xl font-bold font-serif">+30 经验</div>
              <div className="text-muted-foreground mt-2">
                共 {mockCards.length} 张 · 用时 2m 18s · 正确率 67%
              </div>
            </div>
            <Button onClick={() => router.push('/')}>返回学习库</Button>
          </Card>
        </div>
      </AppShell>
    )
  }

  const grade = (gradeValue: 'again' | 'hard' | 'good' | 'easy') => {
    void gradeValue

    if (idx + 1 >= mockCards.length) {
      setDone(true)
    } else {
      setIdx(i => i + 1)
      setFlipped(false)
    }
  }

  return (
    <AppShell>
      <div className="flex-1 flex flex-col items-center justify-center p-6">
        <div className="w-full max-w-lg space-y-4">
          {/* Top bar */}
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => router.push('/')}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <Zap className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium">线性代数 · 特征值与对角化</span>
            <Progress value={((idx + 1) / mockCards.length) * 100} className="flex-1 max-w-[120px] ml-auto" />
            <span className="text-xs text-muted-foreground font-mono">{idx + 1} / {mockCards.length}</span>
          </div>

          {/* Card */}
          <Card
            className={`min-h-[280px] flex flex-col items-center justify-center p-8 text-center cursor-pointer transition-all duration-300 ${
              flipped ? 'bg-secondary/50' : 'hover:border-primary/30'
            }`}
            onClick={() => !flipped && setFlipped(true)}
          >
            <CardContent className="space-y-6 p-0">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <FileText className="h-3 w-3" />
                {card.src}
                <span className="ml-auto">下次复习 · {card.next}</span>
              </div>
              <div className="text-xl font-serif leading-relaxed">{card.q}</div>
              {flipped && (
                <div className="pt-6 border-t border-border">
                  <h4 className="text-sm font-medium text-muted-foreground mb-3">参考答案</h4>
                  <div className="text-base text-left space-y-2 whitespace-pre-line">
                    {card.a}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Actions */}
          {!flipped ? (
            <Button className="w-full" size="lg" onClick={() => setFlipped(true)}>
              显示答案 (空格)
            </Button>
          ) : (
            <div className="grid grid-cols-4 gap-2">
              <GradeButton label="忘了" detail="< 1m" variant="destructive" onClick={() => grade('again')} />
              <GradeButton label="困难" detail="10m" variant="secondary" onClick={() => grade('hard')} />
              <GradeButton label="良好" detail="3 天" variant="default" onClick={() => grade('good')} />
              <GradeButton label="简单" detail="7 天" variant="default" onClick={() => grade('easy')} />
            </div>
          )}
        </div>
      </div>
    </AppShell>
  )
}

function GradeButton({
  label, detail, variant, onClick,
}: {
  label: string; detail: string; variant: 'default' | 'secondary' | 'destructive'; onClick: () => void
}) {
  return (
    <Button variant={variant} size="lg" className="flex-col h-auto py-2 gap-0.5" onClick={onClick}>
      <span className="text-sm font-medium">{label}</span>
      <span className="text-[10px] opacity-70">{detail}</span>
    </Button>
  )
}
