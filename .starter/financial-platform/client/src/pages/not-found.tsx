import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-md text-center">
        <CardContent className="pt-8 pb-8 space-y-4">
          <h1 className="text-4xl font-bold text-muted-foreground" data-testid="text-404">404</h1>
          <p className="text-muted-foreground">Page not found</p>
          <Link href="/">
            <Button data-testid="button-go-home">Go Home</Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
