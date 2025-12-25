import {
  TrendingUp,
  Shield,
  PieChart,
  Smartphone,
  ArrowRight,
  Wallet,
  CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ThemeToggle } from "@/components/ThemeToggle";

const features = [
  {
    icon: TrendingUp,
    title: "Smart Analytics",
    description:
      "Powerful insights into your spending patterns with customizable time periods and category breakdowns.",
  },
  {
    icon: Shield,
    title: "Bank-Level Security",
    description:
      "Connect your accounts securely through Plaid. We never store your bank credentials.",
  },
  {
    icon: PieChart,
    title: "Auto-Categorization",
    description:
      "Transactions are automatically categorized with the ability to customize and create your own categories.",
  },
  {
    icon: Smartphone,
    title: "Mobile Friendly",
    description:
      "Access your financial dashboard anywhere with a fully responsive design that works on any device.",
  },
];

const benefits = [
  "Connect all your bank accounts in one place",
  "Track income, expenses, savings, and investments",
  "Visualize spending trends over time",
  "Customizable categories and tags",
  "Export reports as CSV",
  "Dark and light mode support",
];

export default function Landing() {
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Wallet className="h-5 w-5" />
            </div>
            <span className="text-xl font-bold">Finance Dashboard</span>
          </div>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <a href="/login">
              <Button data-testid="button-login">Log In</Button>
            </a>
          </div>
        </div>
      </header>

      <main>
        <section className="relative overflow-hidden py-20 sm:py-32">
          <div className="absolute inset-0 -z-10 bg-gradient-to-b from-primary/5 to-transparent" />
          <div className="mx-auto max-w-7xl px-4 sm:px-8">
            <div className="mx-auto max-w-3xl text-center">
              <h1 className="mb-6 text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
                Take Control of Your{" "}
                <span className="text-primary">Financial Future</span>
              </h1>
              <p className="mb-10 text-lg text-muted-foreground sm:text-xl">
                Aggregate all your financial accounts, track spending patterns,
                and gain powerful insights to make smarter money decisions.
              </p>
              <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
                <a href="/login">
                  <Button size="lg" className="gap-2" data-testid="button-get-started">
                    Get Started Free
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </a>
              </div>
            </div>
          </div>
        </section>

        <section className="border-y bg-card py-20">
          <div className="mx-auto max-w-7xl px-4 sm:px-8">
            <div className="mb-12 text-center">
              <h2 className="mb-4 text-3xl font-bold">
                Everything You Need to Manage Your Money
              </h2>
              <p className="mx-auto max-w-2xl text-muted-foreground">
                A comprehensive personal finance dashboard with all the tools you
                need to understand and optimize your financial life.
              </p>
            </div>
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {features.map((feature) => (
                <Card key={feature.title} className="border-0 bg-background">
                  <CardContent className="p-6">
                    <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
                      <feature.icon className="h-6 w-6 text-primary" />
                    </div>
                    <h3 className="mb-2 text-lg font-semibold">{feature.title}</h3>
                    <p className="text-sm text-muted-foreground">
                      {feature.description}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        <section className="py-20">
          <div className="mx-auto max-w-7xl px-4 sm:px-8">
            <div className="grid items-center gap-12 lg:grid-cols-2">
              <div>
                <h2 className="mb-6 text-3xl font-bold">
                  All Your Accounts, One Dashboard
                </h2>
                <p className="mb-8 text-muted-foreground">
                  Connect your checking, savings, credit cards, and investment
                  accounts from over 11,000 institutions. Or manually import your
                  data with our flexible CSV upload.
                </p>
                <ul className="space-y-3">
                  {benefits.map((benefit) => (
                    <li key={benefit} className="flex items-center gap-3">
                      <CheckCircle2 className="h-5 w-5 flex-shrink-0 text-primary" />
                      <span>{benefit}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="relative">
                <Card className="overflow-hidden">
                  <CardContent className="p-0">
                    <div className="aspect-video bg-gradient-to-br from-primary/20 via-primary/10 to-transparent p-8">
                      <div className="grid h-full grid-cols-2 gap-4">
                        <div className="space-y-4">
                          <div className="rounded-lg bg-card p-4 shadow-sm">
                            <div className="mb-2 text-sm text-muted-foreground">
                              Net Worth
                            </div>
                            <div className="text-2xl font-bold tabular-nums">
                              $124,582
                            </div>
                          </div>
                          <div className="rounded-lg bg-card p-4 shadow-sm">
                            <div className="mb-2 text-sm text-muted-foreground">
                              Monthly Savings
                            </div>
                            <div className="text-2xl font-bold tabular-nums text-green-600">
                              +$2,340
                            </div>
                          </div>
                        </div>
                        <div className="flex flex-col justify-center">
                          <div className="rounded-lg bg-card p-4 shadow-sm">
                            <div className="mb-3 text-sm font-medium">
                              Spending by Category
                            </div>
                            <div className="space-y-2">
                              <div className="flex items-center justify-between text-sm">
                                <span>Housing</span>
                                <span className="font-medium tabular-nums">32%</span>
                              </div>
                              <div className="h-2 overflow-hidden rounded-full bg-muted">
                                <div
                                  className="h-full bg-primary"
                                  style={{ width: "32%" }}
                                />
                              </div>
                              <div className="flex items-center justify-between text-sm">
                                <span>Food</span>
                                <span className="font-medium tabular-nums">18%</span>
                              </div>
                              <div className="h-2 overflow-hidden rounded-full bg-muted">
                                <div
                                  className="h-full bg-chart-2"
                                  style={{ width: "18%" }}
                                />
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>
        </section>

        <section className="border-t bg-card py-20">
          <div className="mx-auto max-w-7xl px-4 text-center sm:px-8">
            <h2 className="mb-4 text-3xl font-bold">
              Start Your Financial Journey Today
            </h2>
            <p className="mx-auto mb-8 max-w-xl text-muted-foreground">
              Join thousands of users who have taken control of their finances.
              It only takes a few minutes to get started.
            </p>
            <a href="/login">
              <Button size="lg" className="gap-2" data-testid="button-cta-signup">
                Create Free Account
                <ArrowRight className="h-4 w-4" />
              </Button>
            </a>
          </div>
        </section>
      </main>

      <footer className="border-t py-8">
        <div className="mx-auto max-w-7xl px-4 sm:px-8">
          <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Wallet className="h-4 w-4" />
              </div>
              <span className="font-semibold">Finance Dashboard</span>
            </div>
            <p className="text-sm text-muted-foreground">
              Your personal finance companion. All data is encrypted and secure.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
