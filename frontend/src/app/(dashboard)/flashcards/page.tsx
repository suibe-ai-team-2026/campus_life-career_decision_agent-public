'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, FileText, Zap } from 'lucide-react'

import { useDueFlashcards, useGradeFlashcard } from '@/lib/hooks/use-genote'
import { FlashcardGradeValue, FlashcardResponse } from '@/lib/types/api'
import { AppShell } from '@/components/layout/AppShell'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'

export default function FlashcardsPage() {
  const router = useRouter()
  const { data: dueCards = [], isLoading } = useDueFlashcards(50)
  const gradeMutation = useGradeFlashcard()
  const [cards, setCards] = useState<FlashcardResponse[]>([])
  const [started, setStarted] = useState(false)
  const [flipped, setFlipped] = useState(false)
  const [reviewed, setReviewed] = useState(0)

  useEffect(() => {
    if (!started) {
      setCards(dueCards)
      setReviewed(0)
      setFlipped(false)
    }
  }, [dueCards, started])

  const total = useMemo(
    () => Math.max(reviewed + cards.length, dueCards.length),
    [cards.length, dueCards.length, reviewed]
  )
  const card = cards[0]

  const grade = (gradeValue: FlashcardGradeValue) => {
    if (!card) return

    setStarted(true)
    setReviewed(count => count + 1)
    setCards(current => current.slice(1))
    setFlipped(false)
    gradeMutation.mutate({ cardId: card.id, grade: gradeValue })
  }

  if (isLoading) {
    return (
      <AppShell>
        <div className="flex-1 flex items-center justify-center">
          <LoadingSpinner size="lg" />
        </div>
      </AppShell>
    )
  }

  if (!card) {
    return (
      <AppShell>
        <div className="flex-1 flex items-center justify-center p-6">
          <Card className="w-full max-w-md text-center p-8 space-y-4">
            <Zap className="h-12 w-12 mx-auto text-primary" />
            <div>
              <div className="text-2xl font-bold font-serif">
                {started ? `完成 ${reviewed} 张` : '今日没有待复习'}
              </div>
              <div className="text-muted-foreground mt-2">
                {started ? '复习进度已保存' : '创建或导入闪卡后，到期卡片会显示在这里'}
              </div>
            </div>
            <Button onClick={() => router.push('/')}>返回学习库</Button>
          </Card>
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell>
      <div className="flex-1 flex flex-col items-center justify-center p-6">
        <div className="w-full max-w-lg space-y-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => router.push('/')}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <Zap className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium">今日待复习</span>
            <Progress value={(reviewed / total) * 100} className="flex-1 max-w-[120px] ml-auto" />
            <span className="text-xs text-muted-foreground font-mono">{reviewed + 1} / {total}</span>
          </div>

          <Card
            className={`min-h-[280px] flex flex-col items-center justify-center p-8 text-center cursor-pointer transition-all duration-300 ${
              flipped ? 'bg-secondary/50' : 'hover:border-primary/30'
            }`}
            onClick={() => !flipped && setFlipped(true)}
          >
            <CardContent className="space-y-6 p-0 w-full">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <FileText className="h-3 w-3" />
                <span>{card.source_ref || card.deck_id}</span>
                <span className="ml-auto">到期 · {formatReviewDate(card.next_review)}</span>
              </div>
              <div className="text-xl font-serif leading-relaxed">{card.question}</div>
              {flipped && (
                <div className="pt-6 border-t border-border">
                  <h4 className="text-sm font-medium text-muted-foreground mb-3">参考答案</h4>
                  <div className="text-base text-left space-y-2 whitespace-pre-line">
                    {card.answer}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {!flipped ? (
            <Button className="w-full" size="lg" onClick={() => setFlipped(true)}>
              显示答案
            </Button>
          ) : (
            <div className="grid grid-cols-4 gap-2">
              <GradeButton disabled={gradeMutation.isPending} label="忘了" detail="今天" variant="destructive" onClick={() => grade('again')} />
              <GradeButton disabled={gradeMutation.isPending} label="困难" detail="明天" variant="secondary" onClick={() => grade('hard')} />
              <GradeButton disabled={gradeMutation.isPending} label="良好" detail="间隔" variant="default" onClick={() => grade('good')} />
              <GradeButton disabled={gradeMutation.isPending} label="简单" detail="加速" variant="default" onClick={() => grade('easy')} />
            </div>
          )}
        </div>
      </div>
    </AppShell>
  )
}

function GradeButton({
  label, detail, variant, disabled, onClick,
}: {
  label: string
  detail: string
  variant: 'default' | 'secondary' | 'destructive'
  disabled: boolean
  onClick: () => void
}) {
  return (
    <Button
      variant={variant}
      size="lg"
      className="flex-col h-auto py-2 gap-0.5"
      disabled={disabled}
      onClick={onClick}
    >
      <span className="text-sm font-medium">{label}</span>
      <span className="text-[10px] opacity-70">{detail}</span>
    </Button>
  )
}

function formatReviewDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '现在'
  if (date.getTime() <= Date.now()) return '现在'
  return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}
