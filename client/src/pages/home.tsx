import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { loadTimeData } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Truck, Calculator, DollarSign, Clock, Users, Weight, Package, Search, ChevronDown, ChevronUp, History, FileText, Loader2, CheckCircle2, AlertCircle, Plus, X, MapPin, Fuel } from "lucide-react";
import type { Estimate } from "@shared/schema";

const API_BASE = "__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__";

// U-Haul truck MPG by size (conservative real-world estimate)
const TRUCK_MPG: Record<string, number> = {
  "10ft": 5,
  "12ft": 5,
  "15ft": 5,
  "17ft": 5,
  "20ft": 5,
  "26ft": 5,
};

interface TruckLine {
  id: number;
  size: string;
  costOverride: string; // manual cost override — empty means use fetched price
}

interface FetchedTruck {
  truckSize: string;
  price: number | null;
  description: string;
  baseRate?: number;
  mileageRate?: number;
}

// ── Location Autocomplete Input ──
function LocationInput({
  value,
  onChange,
  placeholder,
  disabled,
  testId,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  disabled?: boolean;
  testId: string;
}) {
  const [suggestions, setSuggestions] = useState<{ label: string; value: string }[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleChange = (text: string) => {
    onChange(text);
    if (timerRef.current) clearTimeout(timerRef.current);
    if (text.length < 2) { setSuggestions([]); setOpen(false); return; }
    timerRef.current = setTimeout(async () => {
      try {
        const resp = await fetch(`${API_BASE}/api/uhaul-suggest?term=${encodeURIComponent(text)}`);
        const data = await resp.json();
        setSuggestions(data);
        setOpen(data.length > 0);
      } catch { setSuggestions([]); }
    }, 250);
  };

  return (
    <div ref={ref} className="relative">
      <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
      <Input
        placeholder={placeholder}
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        onFocus={() => { if (suggestions.length > 0) setOpen(true); }}
        disabled={disabled}
        className="pl-9"
        data-testid={testId}
      />
      {open && suggestions.length > 0 && (
        <div className="absolute z-50 mt-1 w-full bg-card border border-border rounded-md shadow-lg max-h-48 overflow-y-auto">
          {suggestions.map((s, i) => (
            <button
              key={i}
              className="w-full text-left px-3 py-2 text-sm hover:bg-muted/60 transition-colors"
              onMouseDown={(e) => { e.preventDefault(); onChange(s.value); setOpen(false); }}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main Component ──
export default function Home() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Form state
  const [customerName, setCustomerName] = useState("");
  const [weightLbs, setWeightLbs] = useState<string>("");
  const [hourlyRate, setHourlyRate] = useState<string>("80");
  const [packingHours, setPackingHours] = useState<string>("");
  const [isLongDistance, setIsLongDistance] = useState(false);
  const [notes, setNotes] = useState("");

  // U-Haul state
  const [needUhaul, setNeedUhaul] = useState(false);
  const [pickupLocation, setPickupLocation] = useState("");
  const [dropoffLocation, setDropoffLocation] = useState("");
  const [tripType, setTripType] = useState("one_way");
  const [moveDate, setMoveDate] = useState("");
  const [estimatedMiles, setEstimatedMiles] = useState<string>("");
  const [gasPrice, setGasPrice] = useState<string>("4.08");
  const [uhaulInsurance, setUhaulInsurance] = useState<string>("100");
  const [uhaulTaxRate, setUhaulTaxRate] = useState<string>("7");

  // Movers override
  const [moversOverride, setMoversOverride] = useState<string>("");

  // Drive time (long distance)
  const [driveTimeHours, setDriveTimeHours] = useState<string>("");
  const [driveTimeMovers, setDriveTimeMovers] = useState<string>("");

  // Long distance expense state
  const [perDiemRate, setPerDiemRate] = useState<string>("50");
  const [perDiemDays, setPerDiemDays] = useState<string>("");
  const [hotelCost, setHotelCost] = useState<string>("");
  const [flightCost, setFlightCost] = useState<string>("");
  const [miscCost, setMiscCost] = useState<string>("");

  // Multiple truck lines
  let nextIdRef = useRef(2);
  const [truckLines, setTruckLines] = useState<TruckLine[]>([{ id: 1, size: "26ft", costOverride: "" }]);

  const addTruck = () => {
    setTruckLines((prev) => [...prev, { id: nextIdRef.current++, size: "26ft", costOverride: "" }]);
  };
  const removeTruck = (id: number) => {
    setTruckLines((prev) => prev.length > 1 ? prev.filter((t) => t.id !== id) : prev);
  };
  const updateTruck = (id: number, field: keyof TruckLine, value: string) => {
    setTruckLines((prev) => prev.map((t) => (t.id === id ? { ...t, [field]: value } : t)));
  };

  // Fetched pricing
  const [fetchingUhaul, setFetchingUhaul] = useState(false);
  const [fetchedTrucks, setFetchedTrucks] = useState<FetchedTruck[] | null>(null);
  const [uhaulMeta, setUhaulMeta] = useState<{ includedDays?: number; includedMiles?: number } | null>(null);
  const [uhaulError, setUhaulError] = useState<string | null>(null);

  // UI state
  const [showHistory, setShowHistory] = useState(false);
  const [generatingPDF, setGeneratingPDF] = useState(false);

  // Reset movers override when weight changes
  useEffect(() => { setMoversOverride(""); }, [weightLbs]);

  // Load time lookup
  const selectedWeight = parseInt(weightLbs) || 0;
  const loadData = useMemo(() => {
    if (!selectedWeight) return null;
    const exact = loadTimeData.find((d) => d.weightLbs === selectedWeight);
    if (exact) return exact;
    const sorted = [...loadTimeData].sort((a, b) => a.weightLbs - b.weightLbs);
    const upper = sorted.find((d) => d.weightLbs >= selectedWeight);
    if (upper) return upper;
    return sorted[sorted.length - 1];
  }, [selectedWeight]);

  // Fuel cost for a single truck
  const getFuelCost = useCallback(
    (size: string): number => {
      const mi = parseFloat(estimatedMiles) || 0;
      const gp = parseFloat(gasPrice) || 0;
      const mpg = TRUCK_MPG[size] || 10;
      if (mi <= 0 || gp <= 0) return 0;
      return (mi / mpg) * gp;
    },
    [estimatedMiles, gasPrice]
  );

  // Cost helper: get rental cost for a single truck line (no fuel)
  const getTruckRentalCost = useCallback(
    (line: TruckLine): number => {
      if (line.costOverride) return parseFloat(line.costOverride) || 0;
      if (!fetchedTrucks) return 0;
      const match = fetchedTrucks.find((ft) => ft.truckSize === line.size);
      if (!match) return 0;
      if (tripType === "in_town" && match.mileageRate) {
        const mi = parseFloat(estimatedMiles) || 0;
        return (match.baseRate || 0) + match.mileageRate * mi;
      }
      return match.price || 0;
    },
    [fetchedTrucks, tripType, estimatedMiles]
  );

  // Total cost for a truck line (rental + fuel for in-town)
  const getTruckCost = useCallback(
    (line: TruckLine): number => {
      const rental = getTruckRentalCost(line);
      if (tripType === "in_town") {
        return rental + getFuelCost(line.size);
      }
      return rental;
    },
    [getTruckRentalCost, getFuelCost, tripType]
  );

  // Effective movers — use override if set, otherwise spreadsheet value
  const numMovers = moversOverride !== "" ? (parseInt(moversOverride) || loadData?.numMovers || 0) : (loadData?.numMovers || 0);
  const totalLaborHours = loadData?.totalLaborHours || 0;
  const hoursPerMover = numMovers > 0 ? totalLaborHours / numMovers : 0;

  // Cost calculations
  const rate = parseFloat(hourlyRate) || 0;
  const laborCost = loadData ? totalLaborHours * rate : 0;
  const packingCost = loadData ? (parseFloat(packingHours) || 0) * rate * numMovers : 0;
  const driveTimeCost = isLongDistance ? (parseFloat(driveTimeHours) || 0) * rate * (parseInt(driveTimeMovers) || 0) : 0;
  const totalUhaulRental = needUhaul ? truckLines.reduce((sum, l) => sum + getTruckRentalCost(l), 0) : 0;
  const totalFuelCost = needUhaul && tripType === "in_town" ? truckLines.reduce((sum, l) => sum + getFuelCost(l.size), 0) : 0;
  const insuranceCost = needUhaul ? (parseFloat(uhaulInsurance) || 0) : 0;
  const taxRate = needUhaul ? (parseFloat(uhaulTaxRate) || 0) / 100 : 0;
  const uhaulSalesTax = needUhaul ? totalUhaulRental * taxRate : 0;
  const totalUhaulCost = totalUhaulRental + totalFuelCost + insuranceCost + uhaulSalesTax;

  // Long distance expenses
  const perDiemTotal = isLongDistance ? numMovers * (parseFloat(perDiemRate) || 0) * (parseFloat(perDiemDays) || 0) : 0;
  const hotelTotal = isLongDistance ? (parseFloat(hotelCost) || 0) : 0;
  const flightTotal = isLongDistance ? (parseFloat(flightCost) || 0) : 0;
  const miscTotal = isLongDistance ? (parseFloat(miscCost) || 0) : 0;
  const longDistanceExpenses = perDiemTotal + hotelTotal + flightTotal + miscTotal;

  const totalEstimate = laborCost + packingCost + driveTimeCost + totalUhaulCost + longDistanceExpenses;

  // History
  const { data: history = [] } = useQuery<Estimate[]>({ queryKey: ["/api/estimates"] });

  // Save estimate
  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!loadData || !customerName.trim()) throw new Error("Missing required fields");
      return apiRequest("POST", "/api/estimates", {
        customerName: customerName.trim(),
        moveType: isLongDistance ? "long_distance" : "local",
        weightLbs: selectedWeight,
        hourlyRate: rate,
        trucks26ft: loadData.trucks26ft,
        trucks17ft: loadData.trucks17ft,
        numMovers: loadData.numMovers,
        numHours: loadData.numHours,
        totalLaborHours: loadData.totalLaborHours,
        laborCost,
        packingHours: packingCost > 0 ? (parseFloat(packingHours) || 0) : null,
        packingCost: packingCost > 0 ? packingCost : null,
        uhaulCost: needUhaul ? totalUhaulCost : null,
        totalEstimate,
        notes: notes || null,
        createdAt: new Date().toISOString(),
      });
    },
    onSuccess: () => {
      toast({ title: "Estimate saved", description: `Estimate for ${customerName} has been saved.` });
      queryClient.invalidateQueries({ queryKey: ["/api/estimates"] });
      setCustomerName("");
      setWeightLbs("");
      setPackingHours("");
      setNotes("");
      setNeedUhaul(false);
      setTruckLines([{ id: 1, size: "26ft", costOverride: "" }]);
    },
    onError: (e: any) => {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    },
  });

  // Generate PDF quote
  const handleGeneratePDF = async () => {
    if (!loadData || !customerName.trim()) {
      toast({ title: "Missing info", description: "Enter customer name and select weight.", variant: "destructive" });
      return;
    }
    setGeneratingPDF(true);
    try {
      const payload = {
        customerName: customerName.trim(),
        moveType: isLongDistance ? "long_distance" : "local",
        weightLbs: selectedWeight,
        hourlyRate: rate,
        trucks26ft: loadData.trucks26ft,
        trucks17ft: loadData.trucks17ft,
        numMovers: loadData.numMovers,
        numHours: loadData.numHours,
        totalLaborHours: loadData.totalLaborHours,
        laborCost,
        packingHours: packingCost > 0 ? (parseFloat(packingHours) || 0) : undefined,
        packingCost: packingCost > 0 ? packingCost : undefined,
        uhaulCost: needUhaul ? totalUhaulCost : null,
        totalEstimate,
        notes: notes || null,
        quoteDate: new Date().toISOString(),
        pickupLocation: needUhaul ? pickupLocation : undefined,
        dropoffLocation: needUhaul && tripType === "one_way" ? dropoffLocation : undefined,
        truckSize: needUhaul ? truckLines.map((l) => l.size).join(", ") : undefined,
        tripType: needUhaul ? tripType : undefined,
      };

      const response = await fetch(`${API_BASE}/api/generate-quote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) throw new Error("Failed to generate PDF");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
      toast({ title: "Quote generated", description: "PDF opened in a new tab. You can print or save from there." });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setGeneratingPDF(false);
    }
  };

  // Fetch U-Haul pricing — tries server first, falls back to client-side
  const handleFetchUhaul = async () => {
    setFetchingUhaul(true);
    setFetchedTrucks(null);
    setUhaulMeta(null);
    setUhaulError(null);
    try {
      const [yr, mo, dy] = moveDate.split("-");
      const formattedDate = `${mo}/${dy}/${yr}`;

      // Try server-side first
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);
      const resp = await fetch(`${API_BASE}/api/uhaul-pricing`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pickup: pickupLocation,
          dropoff: tripType === "one_way" ? dropoffLocation : "",
          date: formattedDate,
          tripType,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      const data = await resp.json();

      if (data.success && data.trucks?.length > 0) {
        setFetchedTrucks(data.trucks);
        setUhaulMeta({ includedDays: data.includedDays, includedMiles: data.includedMiles });
        toast({ title: "U-Haul pricing loaded", description: `Found pricing for ${data.trucks.length} truck sizes.` });
        return;
      }

      setUhaulError(data.error || "Could not retrieve pricing. Enter costs manually below.");
    } catch {
      setUhaulError("Failed to connect. Please try again.");
    } finally {
      setFetchingUhaul(false);
    }
  };



  // Helper: format currency
  const fmt = (n: number) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // Helper: get fetched info for a truck size
  const getFetchedInfo = (size: string) => fetchedTrucks?.find((ft) => ft.truckSize === size) || null;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary flex items-center justify-center">
              <Truck className="w-5 h-5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-foreground" data-testid="text-app-title">Moving Estimate Calculator</h1>
              <p className="text-xs text-muted-foreground">Quick estimates for your intake team</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => setShowHistory(!showHistory)} data-testid="button-toggle-history">
            <History className="w-4 h-4 mr-1.5" />History
            {showHistory ? <ChevronUp className="w-3 h-3 ml-1" /> : <ChevronDown className="w-3 h-3 ml-1" />}
          </Button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        {/* Move Type Toggle */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-foreground">Move Type</p>
                <p className="text-sm text-muted-foreground">
                  {isLongDistance ? "Long distance move" : "Local move"}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className={`text-sm font-medium ${!isLongDistance ? "text-foreground" : "text-muted-foreground"}`}>Local</span>
                <Switch checked={isLongDistance} onCheckedChange={setIsLongDistance} data-testid="switch-move-type" />
                <span className={`text-sm font-medium ${isLongDistance ? "text-foreground" : "text-muted-foreground"}`}>Long Distance</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column */}
          <div className="lg:col-span-2 space-y-6">
            {/* Job Details */}
            <Card>
              <CardHeader className="pb-4">
                <CardTitle className="text-base flex items-center gap-2">
                  <Package className="w-4 h-4 text-primary" />Job Details
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="customerName">Customer Name</Label>
                    <Input id="customerName" placeholder="e.g. John Smith" value={customerName} onChange={(e) => setCustomerName(e.target.value)} data-testid="input-customer-name" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="weight">Estimated Weight (lbs)</Label>
                    <Select value={weightLbs} onValueChange={setWeightLbs}>
                      <SelectTrigger data-testid="select-weight"><SelectValue placeholder="Select weight bracket" /></SelectTrigger>
                      <SelectContent>
                        {loadTimeData.map((d) => (
                          <SelectItem key={d.weightLbs} value={String(d.weightLbs)}>{d.weightLbs.toLocaleString()} lbs</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="hourlyRate">Hourly Rate (per mover)</Label>
                  <div className="relative">
                    <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input id="hourlyRate" type="number" min="0" step="5" className="pl-8" value={hourlyRate} onChange={(e) => setHourlyRate(e.target.value)} data-testid="input-hourly-rate" />
                  </div>
                  <p className="text-xs text-muted-foreground">Default: $80/hr per mover</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="packingHours">Packing Hours</Label>
                  <div className="relative">
                    <Clock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      id="packingHours"
                      type="number"
                      min="0"
                      step="0.5"
                      className="pl-8"
                      placeholder="0"
                      value={packingHours}
                      onChange={(e) => setPackingHours(e.target.value)}
                      data-testid="input-packing-hours"
                    />
                  </div>
                  {packingCost > 0 && loadData && (
                    <p className="text-xs text-muted-foreground">
                      {packingHours} hrs × ${rate}/hr × {numMovers} movers = {fmt(packingCost)}
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="notes">Notes (optional)</Label>
                  <Textarea id="notes" placeholder="Stairs, special items, access issues..." value={notes} onChange={(e) => setNotes(e.target.value)} className="h-20 resize-none" data-testid="input-notes" />
                </div>
              </CardContent>
            </Card>

            {/* Load Breakdown */}
            {loadData && (
              <Card>
                <CardHeader className="pb-4">
                  <CardTitle className="text-base flex items-center gap-2"><Truck className="w-4 h-4 text-primary" />Load Breakdown</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    <div className="bg-muted/50 rounded-lg p-3 text-center">
                      <Weight className="w-4 h-4 mx-auto mb-1 text-muted-foreground" />
                      <p className="text-xs text-muted-foreground">Weight</p>
                      <p className="text-lg font-semibold text-foreground" data-testid="text-weight">{loadData.weightLbs.toLocaleString()} lbs</p>
                    </div>
                    <div className="bg-muted/50 rounded-lg p-3 text-center">
                      <Users className="w-4 h-4 mx-auto mb-1 text-muted-foreground" />
                      <p className="text-xs text-muted-foreground">Movers</p>
                      <Input
                        type="number"
                        min="1"
                        step="1"
                        className="text-lg font-semibold text-center bg-transparent border-0 border-b border-border rounded-none px-0 h-auto p-0 mt-1 focus-visible:ring-0"
                        value={moversOverride !== "" ? moversOverride : loadData.numMovers}
                        onChange={(e) => setMoversOverride(e.target.value)}
                        data-testid="input-movers"
                      />
                      {moversOverride !== "" && parseInt(moversOverride) !== loadData.numMovers && (
                        <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
                          (was {loadData.numMovers})
                        </p>
                      )}
                    </div>
                    <div className="bg-muted/50 rounded-lg p-3 text-center">
                      <Clock className="w-4 h-4 mx-auto mb-1 text-muted-foreground" />
                      <p className="text-xs text-muted-foreground">Hrs / Mover</p>
                      <p className="text-lg font-semibold text-foreground" data-testid="text-hours">
                        {hoursPerMover % 1 === 0 ? hoursPerMover : hoursPerMover.toFixed(1)}
                      </p>
                    </div>
                    <div className="bg-muted/50 rounded-lg p-3 text-center">
                      <Truck className="w-4 h-4 mx-auto mb-1 text-muted-foreground" />
                      <p className="text-xs text-muted-foreground">Trucks</p>
                      <p className="text-lg font-semibold text-foreground" data-testid="text-trucks">
                        {loadData.trucks26ft > 0 && <span>{loadData.trucks26ft}x 26ft</span>}
                        {loadData.trucks26ft > 0 && loadData.trucks17ft > 0 && <span> + </span>}
                        {loadData.trucks17ft > 0 && <span>{loadData.trucks17ft}x 17ft</span>}
                      </p>
                    </div>
                  </div>
                  <div className="mt-4 p-3 bg-primary/5 rounded-lg border border-primary/10">
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-muted-foreground">Total Labor Hours</span>
                      <span className="font-semibold text-foreground" data-testid="text-total-labor-hours">
                        {totalLaborHours} hrs ({numMovers} movers × {hoursPerMover % 1 === 0 ? hoursPerMover : hoursPerMover.toFixed(1)} hrs)
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* ── Long Distance Expenses ── */}
            {isLongDistance && loadData && (
              <Card className="border-violet-200 dark:border-violet-900/50">
                <CardHeader className="pb-4">
                  <CardTitle className="text-base flex items-center gap-2">
                    <DollarSign className="w-4 h-4 text-violet-600 dark:text-violet-400" />
                    Long Distance Expenses
                    <Badge variant="secondary" className="ml-auto text-xs">Long Distance</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Drive Time */}
                  <div className="space-y-2">
                    <Label className="font-medium">Drive Time Labor</Label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Drive Time (hours)</Label>
                        <div className="relative">
                          <Clock className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                          <Input
                            type="number"
                            min="0"
                            step="0.5"
                            className="pl-7"
                            placeholder="e.g. 8"
                            value={driveTimeHours}
                            onChange={(e) => setDriveTimeHours(e.target.value)}
                            data-testid="input-drive-time-hours"
                          />
                        </div>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Movers on Drive</Label>
                        <div className="relative">
                          <Users className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                          <Input
                            type="number"
                            min="1"
                            step="1"
                            className="pl-7"
                            placeholder="e.g. 2"
                            value={driveTimeMovers}
                            onChange={(e) => setDriveTimeMovers(e.target.value)}
                            data-testid="input-drive-time-movers"
                          />
                        </div>
                      </div>
                    </div>
                    {driveTimeCost > 0 && (
                      <p className="text-xs text-violet-600 dark:text-violet-400">
                        {driveTimeHours} hrs × ${rate}/hr × {driveTimeMovers} movers = {fmt(driveTimeCost)}
                      </p>
                    )}
                  </div>

                  <Separator />

                  {/* Per Diem */}
                  <div className="space-y-2">
                    <Label className="font-medium">Per Diem</Label>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Movers (from spreadsheet)</Label>
                        <Input value={numMovers} disabled className="bg-muted/50" />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Rate Per Mover/Day</Label>
                        <div className="relative">
                          <DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                          <Input
                            type="number"
                            min="0"
                            step="5"
                            className="pl-7"
                            value={perDiemRate}
                            onChange={(e) => setPerDiemRate(e.target.value)}
                            data-testid="input-per-diem-rate"
                          />
                        </div>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Number of Days</Label>
                        <Input
                          type="number"
                          min="0"
                          step="1"
                          placeholder="e.g. 2"
                          value={perDiemDays}
                          onChange={(e) => setPerDiemDays(e.target.value)}
                          data-testid="input-per-diem-days"
                        />
                      </div>
                    </div>
                    {perDiemTotal > 0 && (
                      <p className="text-xs text-violet-600 dark:text-violet-400">
                        {numMovers} movers × {fmt(parseFloat(perDiemRate) || 0)}/day × {perDiemDays} day{parseFloat(perDiemDays) !== 1 ? "s" : ""} = {fmt(perDiemTotal)}
                      </p>
                    )}
                  </div>

                  <Separator />

                  {/* Hotel / Flight / Misc */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label>Hotel Cost</Label>
                      <div className="relative">
                        <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <Input
                          type="number"
                          min="0"
                          step="1"
                          className="pl-8"
                          placeholder="0.00"
                          value={hotelCost}
                          onChange={(e) => setHotelCost(e.target.value)}
                          data-testid="input-hotel-cost"
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>Flight Cost</Label>
                      <div className="relative">
                        <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <Input
                          type="number"
                          min="0"
                          step="1"
                          className="pl-8"
                          placeholder="0.00"
                          value={flightCost}
                          onChange={(e) => setFlightCost(e.target.value)}
                          data-testid="input-flight-cost"
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>Misc / Other</Label>
                      <div className="relative">
                        <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <Input
                          type="number"
                          min="0"
                          step="1"
                          className="pl-8"
                          placeholder="0.00"
                          value={miscCost}
                          onChange={(e) => setMiscCost(e.target.value)}
                          data-testid="input-misc-cost"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Subtotal */}
                  {(driveTimeCost > 0 || longDistanceExpenses > 0) && (
                    <div className="p-3 bg-violet-50 dark:bg-violet-950/20 rounded-lg border border-violet-200 dark:border-violet-800">
                      <div className="space-y-1">
                        {driveTimeCost > 0 && (
                          <div className="flex justify-between text-xs">
                            <span className="text-violet-600 dark:text-violet-400">Drive Time Labor</span>
                            <span className="text-violet-700 dark:text-violet-300">{fmt(driveTimeCost)}</span>
                          </div>
                        )}
                        {perDiemTotal > 0 && (
                          <div className="flex justify-between text-xs">
                            <span className="text-violet-600 dark:text-violet-400">Per Diem</span>
                            <span className="text-violet-700 dark:text-violet-300">{fmt(perDiemTotal)}</span>
                          </div>
                        )}
                        {hotelTotal > 0 && (
                          <div className="flex justify-between text-xs">
                            <span className="text-violet-600 dark:text-violet-400">Hotel</span>
                            <span className="text-violet-700 dark:text-violet-300">{fmt(hotelTotal)}</span>
                          </div>
                        )}
                        {flightTotal > 0 && (
                          <div className="flex justify-between text-xs">
                            <span className="text-violet-600 dark:text-violet-400">Flights</span>
                            <span className="text-violet-700 dark:text-violet-300">{fmt(flightTotal)}</span>
                          </div>
                        )}
                        {miscTotal > 0 && (
                          <div className="flex justify-between text-xs">
                            <span className="text-violet-600 dark:text-violet-400">Misc / Other</span>
                            <span className="text-violet-700 dark:text-violet-300">{fmt(miscTotal)}</span>
                          </div>
                        )}
                        <Separator className="bg-violet-200 dark:bg-violet-800" />
                        <div className="flex justify-between text-sm font-semibold">
                          <span className="text-violet-700 dark:text-violet-300">LD Expenses Total</span>
                          <span className="text-violet-700 dark:text-violet-300">{fmt(driveTimeCost + longDistanceExpenses)}</span>
                        </div>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* ── U-Haul Rental ── */}
            <Card className={needUhaul ? "border-amber-200 dark:border-amber-900/50" : ""}>
              <CardHeader className="pb-4">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Truck className="w-4 h-4 text-amber-600 dark:text-amber-400" />U-Haul Rental
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-medium ${!needUhaul ? "text-muted-foreground" : "text-amber-600 dark:text-amber-400"}`}>
                      {needUhaul ? "Included" : "Not needed"}
                    </span>
                    <Switch checked={needUhaul} onCheckedChange={setNeedUhaul} data-testid="switch-need-uhaul" />
                  </div>
                </div>
              </CardHeader>
              {needUhaul && (
                <CardContent className="space-y-4">
                  {/* Locations */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Pickup Location</Label>
                      <LocationInput value={pickupLocation} onChange={setPickupLocation} placeholder="Start typing a city..." testId="input-pickup-location" />
                    </div>
                    <div className="space-y-2">
                      <Label>Drop-off Location</Label>
                      <LocationInput
                        value={dropoffLocation}
                        onChange={setDropoffLocation}
                        placeholder={tripType === "in_town" ? "Same as pickup" : "Start typing a city..."}
                        disabled={tripType === "in_town"}
                        testId="input-dropoff-location"
                      />
                    </div>
                  </div>

                  {/* Trip Type + Date + Miles */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Trip Type</Label>
                      <Select value={tripType} onValueChange={(v) => { setTripType(v); setFetchedTrucks(null); }} >
                        <SelectTrigger data-testid="select-trip-type"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="one_way">One Way (drop off at destination)</SelectItem>
                          <SelectItem value="in_town">Return to Same Location</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Move Date</Label>
                      <Input type="date" value={moveDate} onChange={(e) => setMoveDate(e.target.value)} data-testid="input-move-date" />
                    </div>
                  </div>

                  {/* Miles + Fuel for in-town */}
                  {tripType === "in_town" && (
                    <div className="space-y-3">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label>Estimated Round-Trip Miles</Label>
                          <Input
                            type="number"
                            min="0"
                            step="1"
                            placeholder="e.g. 30"
                            value={estimatedMiles}
                            onChange={(e) => setEstimatedMiles(e.target.value)}
                            data-testid="input-estimated-miles"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Gas Price (per gallon)</Label>
                          <div className="relative">
                            <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                            <Input
                              type="number"
                              min="0"
                              step="0.01"
                              className="pl-8"
                              value={gasPrice}
                              onChange={(e) => setGasPrice(e.target.value)}
                              data-testid="input-gas-price"
                            />
                          </div>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground">U-Haul charges a base daily rate + per-mile fee. Fuel cost estimated using truck MPG.</p>
                      {(parseFloat(estimatedMiles) || 0) > 0 && (parseFloat(gasPrice) || 0) > 0 && (
                        <div className="p-3 bg-muted/40 rounded-lg border border-border space-y-1.5">
                          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                            <Fuel className="w-3.5 h-3.5" />Fuel Cost Estimate
                          </div>
                          {truckLines.map((line, idx) => {
                            const mpg = TRUCK_MPG[line.size] || 10;
                            const fuel = getFuelCost(line.size);
                            const mi = parseFloat(estimatedMiles) || 0;
                            const gallons = mi / mpg;
                            return (
                              <div key={line.id} className="flex justify-between text-xs">
                                <span className="text-muted-foreground">
                                  {truckLines.length > 1 ? `Truck ${idx + 1} — ` : ""}{line.size.replace("ft", "'")} ({mpg} MPG) — {gallons.toFixed(1)} gal × {fmt(parseFloat(gasPrice) || 0)}
                                </span>
                                <span className="font-medium text-foreground">{fmt(fuel)}</span>
                              </div>
                            );
                          })}
                          {truckLines.length > 1 && (
                            <div className="flex justify-between text-xs pt-1 border-t border-border">
                              <span className="font-medium text-muted-foreground">Total Fuel</span>
                              <span className="font-semibold text-foreground">{fmt(totalFuelCost)}</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  <Separator />

                  {/* Fetch pricing button */}
                  <Button
                    className="w-full bg-amber-600 hover:bg-amber-700 text-white"
                    disabled={!pickupLocation.trim() || (tripType === "one_way" && !dropoffLocation.trim()) || !moveDate || fetchingUhaul}
                    onClick={handleFetchUhaul}
                    data-testid="button-uhaul-pricing"
                  >
                    {fetchingUhaul ? (
                      <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" />Fetching U-Haul Pricing...</>
                    ) : (
                      <><Search className="w-4 h-4 mr-1.5" />Get U-Haul Pricing</>
                    )}
                  </Button>

                  {fetchingUhaul && (
                    <div className="p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg">
                      <p className="text-xs text-amber-700 dark:text-amber-400 text-center">Checking U-Haul rates... this may take 15–30 seconds.</p>
                    </div>
                  )}

                  {uhaulError && (
                    <div className="p-3 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-lg flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
                      <div>
                        <p className="text-xs text-red-700 dark:text-red-400">{uhaulError}</p>
                        <div className="flex flex-wrap items-center gap-x-1 mt-1">
                          <p className="text-xs text-red-500">Enter costs manually below, or</p>
                          <a
                            href={`https://www.uhaul.com/Trucks/?PickupLocation=${encodeURIComponent(pickupLocation)}${tripType === "one_way" && dropoffLocation ? `&DropoffLocation=${encodeURIComponent(dropoffLocation)}` : ""}${moveDate ? `&PickupDate=${encodeURIComponent((() => { const [yr, mo, dy] = moveDate.split("-"); return `${mo}/${dy}/${yr}`; })())}` : ""}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
                          >
                            get quote on U-Haul →
                          </a>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Rate info from fetch */}
                  {fetchedTrucks && uhaulMeta && tripType === "one_way" && (uhaulMeta.includedDays || uhaulMeta.includedMiles) && (
                    <p className="text-xs text-amber-600 dark:text-amber-400">
                      One-way rates include {uhaulMeta.includedDays && `up to ${uhaulMeta.includedDays} days`}{uhaulMeta.includedDays && uhaulMeta.includedMiles && " and "}{uhaulMeta.includedMiles && `${uhaulMeta.includedMiles.toLocaleString()} miles`}
                    </p>
                  )}

                  {/* ── Truck Lines ── */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm font-medium">U-Haul Trucks</Label>
                      <Button variant="outline" size="sm" onClick={addTruck} data-testid="button-add-truck">
                        <Plus className="w-3.5 h-3.5 mr-1" />Add Truck
                      </Button>
                    </div>

                    {truckLines.map((line, idx) => {
                      const info = getFetchedInfo(line.size);
                      const cost = getTruckCost(line);
                      return (
                        <div key={line.id} className="p-3 rounded-lg border border-border bg-muted/20 space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-medium text-muted-foreground">Truck {idx + 1}</span>
                            {truckLines.length > 1 && (
                              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeTruck(line.id)}>
                                <X className="w-3.5 h-3.5 text-muted-foreground" />
                              </Button>
                            )}
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div className="space-y-1">
                              <Label className="text-xs">Truck Size</Label>
                              <Select value={line.size} onValueChange={(v) => updateTruck(line.id, "size", v)}>
                                <SelectTrigger className="h-9" data-testid={`select-truck-size-${line.id}`}><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="26ft">26 ft (up to 4 rooms)</SelectItem>
                                  <SelectItem value="20ft">20 ft (up to 3 rooms)</SelectItem>
                                  <SelectItem value="17ft">17 ft (up to 2 rooms)</SelectItem>
                                  <SelectItem value="15ft">15 ft (up to 2 rooms)</SelectItem>
                                  <SelectItem value="12ft">12 ft (up to 1 room)</SelectItem>
                                  <SelectItem value="10ft">10 ft (studio/small)</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs">
                                Cost Override
                                <span className="text-muted-foreground font-normal"> (or leave blank for fetched price)</span>
                              </Label>
                              <div className="relative">
                                <DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                                <Input
                                  type="number"
                                  min="0"
                                  step="1"
                                  className="h-9 pl-7 text-sm"
                                  placeholder={info ? (tripType === "in_town" && info.mileageRate ? `${fmt(info.baseRate || 0)} + ${fmt(info.mileageRate)}/mi` : fmt(info.price || 0)) : "Enter manually"}
                                  value={line.costOverride}
                                  onChange={(e) => updateTruck(line.id, "costOverride", e.target.value)}
                                  data-testid={`input-truck-cost-${line.id}`}
                                />
                              </div>
                            </div>
                          </div>
                          {/* Show fetched rate info */}
                          {info && !line.costOverride && (
                            <div className="flex items-center justify-between text-xs">
                              <span className="text-muted-foreground">
                                {info.description && <>{info.description} — </>}
                                {tripType === "in_town" && info.mileageRate
                                  ? <>{fmt(info.baseRate || 0)}/day + {fmt(info.mileageRate)}/mile</>
                                  : <>Rate: {fmt(info.price || 0)}</>
                                }
                              </span>
                              <span className="font-medium text-amber-700 dark:text-amber-400 flex items-center gap-1">
                                {cost > 0 ? fmt(cost) : "—"}
                                <CheckCircle2 className="w-3.5 h-3.5" />
                              </span>
                            </div>
                          )}
                          {line.costOverride && (
                            <div className="flex items-center justify-end text-xs">
                              <span className="font-medium text-foreground">{fmt(cost)}</span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Insurance + Tax */}
                  <Separator />
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Insurance (SafeMove)</Label>
                      <div className="relative">
                        <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <Input
                          type="number"
                          min="0"
                          step="1"
                          className="pl-8"
                          value={uhaulInsurance}
                          onChange={(e) => setUhaulInsurance(e.target.value)}
                          data-testid="input-uhaul-insurance"
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>Sales Tax Rate (%)</Label>
                      <div className="relative">
                        <Input
                          type="number"
                          min="0"
                          step="0.1"
                          value={uhaulTaxRate}
                          onChange={(e) => setUhaulTaxRate(e.target.value)}
                          data-testid="input-uhaul-tax-rate"
                        />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">%</span>
                      </div>
                      {uhaulSalesTax > 0 && (
                        <p className="text-xs text-muted-foreground">
                          {uhaulTaxRate}% on {fmt(totalUhaulRental)} rental = {fmt(uhaulSalesTax)}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Total U-Haul summary */}
                  {(totalUhaulRental > 0 || insuranceCost > 0) && (
                    <div className="p-3 bg-amber-50 dark:bg-amber-950/20 rounded-lg border border-amber-200 dark:border-amber-800">
                      <div className="space-y-1">
                        {totalUhaulRental > 0 && (
                          <div className="flex justify-between text-xs">
                            <span className="text-amber-600 dark:text-amber-400">
                              Rental ({truckLines.length} truck{truckLines.length > 1 ? "s" : ""})
                            </span>
                            <span className="text-amber-700 dark:text-amber-300">{fmt(totalUhaulRental)}</span>
                          </div>
                        )}
                        {tripType === "in_town" && totalFuelCost > 0 && (
                          <div className="flex justify-between text-xs">
                            <span className="text-amber-600 dark:text-amber-400">Fuel</span>
                            <span className="text-amber-700 dark:text-amber-300">{fmt(totalFuelCost)}</span>
                          </div>
                        )}
                        {insuranceCost > 0 && (
                          <div className="flex justify-between text-xs">
                            <span className="text-amber-600 dark:text-amber-400">Insurance</span>
                            <span className="text-amber-700 dark:text-amber-300">{fmt(insuranceCost)}</span>
                          </div>
                        )}
                        {uhaulSalesTax > 0 && (
                          <div className="flex justify-between text-xs">
                            <span className="text-amber-600 dark:text-amber-400">Sales Tax ({uhaulTaxRate}%)</span>
                            <span className="text-amber-700 dark:text-amber-300">{fmt(uhaulSalesTax)}</span>
                          </div>
                        )}
                        <Separator className="bg-amber-200 dark:bg-amber-800" />
                        <div className="flex justify-between text-sm font-semibold">
                          <span className="text-amber-700 dark:text-amber-400">U-Haul Total</span>
                          <span className="text-amber-700 dark:text-amber-400">{fmt(totalUhaulCost)}</span>
                        </div>
                      </div>
                    </div>
                  )}
                </CardContent>
              )}
            </Card>
          </div>

          {/* Right Column — Estimate Summary */}
          <div className="space-y-6">
            <Card className="border-primary/20 sticky top-6">
              <CardHeader className="pb-4 bg-primary/5 rounded-t-lg">
                <CardTitle className="text-base flex items-center gap-2">
                  <Calculator className="w-4 h-4 text-primary" />Estimate Summary
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4 space-y-3">
                {loadData ? (
                  <>
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Rate</span>
                        <span className="text-foreground" data-testid="text-rate">${rate.toFixed(2)}/hr per mover</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Movers</span>
                        <span className="text-foreground">
                          {numMovers}
                          {moversOverride !== "" && parseInt(moversOverride) !== loadData.numMovers && (
                            <span className="text-xs text-amber-600 dark:text-amber-400 ml-1">(adjusted)</span>
                          )}
                        </span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Hrs / Mover</span>
                        <span className="text-foreground">{hoursPerMover % 1 === 0 ? hoursPerMover : hoursPerMover.toFixed(1)} hrs</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Total Labor Hours</span>
                        <span className="text-foreground">{totalLaborHours} hrs</span>
                      </div>
                      <Separator />
                      <div className="flex justify-between text-sm font-medium">
                        <span className="text-foreground">Labor Cost</span>
                        <span className="text-foreground" data-testid="text-labor-cost">{fmt(laborCost)}</span>
                      </div>
                      {driveTimeCost > 0 && (
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground flex items-center gap-1">
                            <Truck className="w-3 h-3" />Drive Time Labor
                          </span>
                          <span className="text-foreground">{fmt(driveTimeCost)}</span>
                        </div>
                      )}
                      {packingCost > 0 && (
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground flex items-center gap-1">
                            <Package className="w-3 h-3" />Packing
                          </span>
                          <span className="text-foreground" data-testid="text-packing-cost">{fmt(packingCost)}</span>
                        </div>
                      )}
                      {needUhaul && (
                        <>
                          <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">
                              U-Haul Rental{truckLines.length > 1 ? ` (${truckLines.length})` : ""}
                            </span>
                            <span className="text-foreground" data-testid="text-uhaul-cost">
                              {totalUhaulRental > 0 ? fmt(totalUhaulRental) : "—"}
                            </span>
                          </div>
                          {tripType === "in_town" && totalFuelCost > 0 && (
                            <div className="flex justify-between text-sm">
                              <span className="text-muted-foreground flex items-center gap-1">
                                <Fuel className="w-3 h-3" />Fuel Est.
                              </span>
                              <span className="text-foreground">{fmt(totalFuelCost)}</span>
                            </div>
                          )}
                        </>
                      )}
                      {isLongDistance && longDistanceExpenses > 0 && (
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">LD Expenses</span>
                          <span className="text-foreground">{fmt(longDistanceExpenses)}</span>
                        </div>
                      )}
                      <Separator />
                      <div className="flex justify-between items-center pt-1">
                        <span className="font-semibold text-foreground">Total Estimate</span>
                        <span className="text-xl font-bold text-primary" data-testid="text-total-estimate">{fmt(totalEstimate)}</span>
                      </div>
                    </div>

                    <div className="flex flex-col gap-2 mt-4">
                      <Button className="w-full" disabled={!customerName.trim() || saveMutation.isPending} onClick={() => saveMutation.mutate()} data-testid="button-save-estimate">
                        {saveMutation.isPending ? "Saving..." : "Save Estimate"}
                      </Button>
                      <Button variant="outline" className="w-full border-primary/30 text-primary hover:bg-primary/5" disabled={!customerName.trim() || !loadData || generatingPDF} onClick={handleGeneratePDF} data-testid="button-generate-pdf">
                        {generatingPDF ? (
                          <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" />Generating...</>
                        ) : (
                          <><FileText className="w-4 h-4 mr-1.5" />Generate Client Quote PDF</>
                        )}
                      </Button>
                    </div>
                  </>
                ) : (
                  <div className="py-8 text-center text-muted-foreground text-sm">
                    <Weight className="w-8 h-8 mx-auto mb-2 opacity-40" />
                    Select a weight bracket to see the estimate
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Quick Reference */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm text-muted-foreground font-medium">Quick Reference</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-1.5 text-xs text-muted-foreground">
                  <p>Studio / 1BR: ~2,000 – 4,000 lbs</p>
                  <p>2BR apartment: ~4,000 – 6,000 lbs</p>
                  <p>3BR house: ~8,000 – 12,000 lbs</p>
                  <p>4BR house: ~12,000 – 16,000 lbs</p>
                  <p>5BR+ house: ~16,000 – 22,000 lbs</p>
                  <p>Large estate: ~22,000 – 30,000 lbs</p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* History */}
        {showHistory && history.length > 0 && (
          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="text-base flex items-center gap-2">
                <History className="w-4 h-4 text-primary" />Recent Estimates
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-2 pr-4 text-muted-foreground font-medium">Customer</th>
                      <th className="text-left py-2 pr-4 text-muted-foreground font-medium">Type</th>
                      <th className="text-right py-2 pr-4 text-muted-foreground font-medium">Weight</th>
                      <th className="text-right py-2 pr-4 text-muted-foreground font-medium">Movers</th>
                      <th className="text-right py-2 pr-4 text-muted-foreground font-medium">Hours</th>
                      <th className="text-right py-2 pr-4 text-muted-foreground font-medium">Labor</th>
                      <th className="text-right py-2 pr-4 text-muted-foreground font-medium">U-Haul</th>
                      <th className="text-right py-2 text-muted-foreground font-medium">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((est) => (
                      <tr key={est.id} className="border-b border-border/50 last:border-0">
                        <td className="py-2 pr-4 font-medium text-foreground">{est.customerName}</td>
                        <td className="py-2 pr-4">
                          <Badge variant={est.moveType === "long_distance" ? "default" : "secondary"} className="text-xs">
                            {est.moveType === "long_distance" ? "Long Distance" : "Local"}
                          </Badge>
                        </td>
                        <td className="py-2 pr-4 text-right text-muted-foreground">{est.weightLbs.toLocaleString()} lbs</td>
                        <td className="py-2 pr-4 text-right text-muted-foreground">{est.numMovers}</td>
                        <td className="py-2 pr-4 text-right text-muted-foreground">{est.numHours}</td>
                        <td className="py-2 pr-4 text-right text-foreground">${est.laborCost.toLocaleString("en-US", { minimumFractionDigits: 2 })}</td>
                        <td className="py-2 pr-4 text-right text-muted-foreground">{est.uhaulCost ? `$${est.uhaulCost.toLocaleString("en-US", { minimumFractionDigits: 2 })}` : "—"}</td>
                        <td className="py-2 text-right font-semibold text-primary">${est.totalEstimate.toLocaleString("en-US", { minimumFractionDigits: 2 })}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
