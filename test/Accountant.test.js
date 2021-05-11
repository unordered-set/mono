/* global artifacts web3 */
const {
  expect,
  BN,
  bigVal,
  mochaEach,
  tolerance,
  usdcVal,
  SECONDS_PER_DAY,
  SECONDS_PER_YEAR,
  deployAllContracts,
} = require("./testHelpers.js")
const hre = require("hardhat")
const {deployments} = hre
const {interestAprAsBN, INTEREST_DECIMALS, ETHDecimals} = require("../blockchain_scripts/deployHelpers.js")
const Accountant = artifacts.require("Accountant")
const TestAccountant = artifacts.require("TestAccountant")
const CreditLine = artifacts.require("CreditLine")

describe("Accountant", async () => {
  let accountant, owner, borrower, testAccountant, goldfinchConfig
  before(async () => {
    // Linking can only happen once, so we do it in a before block, rather than beforeEach
    accountant = await Accountant.new({from: owner})
    CreditLine.link(accountant)
    TestAccountant.link(accountant)
  })

  const setupTest = deployments.createFixture(async ({deployments}) => {
    return await deployAllContracts(deployments)
  })

  beforeEach(async () => {
    ;[owner, borrower] = await web3.eth.getAccounts()
    let contracts = await setupTest()
    goldfinchConfig = contracts.goldfinchConfig
    testAccountant = await TestAccountant.new({from: owner})
  })

  describe("calculateInterestAndPrincipalAccrued", async () => {
    let creditLine,
      balance,
      timestamp,
      lateFeeApr,
      lateFeeGracePeriod,
      lateFeeGracePeriodInDays,
      paymentPeriodInDays,
      termInDays,
      interestApr
    const calculateInterestAndPrincipalAccrued = async (timestamp) => {
      const result = await testAccountant.calculateInterestAndPrincipalAccrued(
        creditLine.address,
        timestamp,
        lateFeeGracePeriodInDays
      )
      return [result[0], result[1]]
    }
    // You can get this by taking the interest rate * principal, and divide by the fraction of seconds elapsed (100 in our case) to seconds in the term
    // (1000 * 0.03) * (100 / 2592000) = 1157
    let expectedInterest = new BN(String(1157))
    beforeEach(async () => {
      balance = usdcVal(1000)
      interestApr = interestAprAsBN("3.00")
      lateFeeApr = interestAprAsBN("3")
      lateFeeGracePeriod = new BN(1)
      termInDays = new BN(360)
      paymentPeriodInDays = new BN(30)
      lateFeeGracePeriodInDays = lateFeeGracePeriod.mul(paymentPeriodInDays)
      creditLine = await CreditLine.new({from: owner})
      await creditLine.initialize(
        goldfinchConfig.address,
        owner,
        borrower,
        bigVal(500),
        interestApr,
        paymentPeriodInDays,
        termInDays,
        lateFeeApr
      )
      let currentTime = new BN(Date.now() / 1000)
      await creditLine.setInterestAccruedAsOf(currentTime)
      await creditLine.setBalance(balance)
      timestamp = currentTime.add(new BN(100))
      await creditLine.setTermEndTime(timestamp)
    })
    describe("when the timestamp is < the term end date", async () => {
      it("should return zero principal, but full interest", async () => {
        const [interestAccrued, principalAccrued] = await calculateInterestAndPrincipalAccrued(timestamp.sub(new BN(1)))
        expect(interestAccrued).to.bignumber.closeTo(expectedInterest, tolerance)
        expect(principalAccrued).to.bignumber.equal(new BN(0))
      })
    })
    describe("when the timestamp == the term end date", async () => {
      it("should return the full principal and full interest", async () => {
        const [interestAccrued, principalAccrued] = await calculateInterestAndPrincipalAccrued(timestamp)
        expect(interestAccrued).to.bignumber.closeTo(expectedInterest, tolerance)
        expect(principalAccrued).to.bignumber.equal(balance)
      })
    })
    describe("when the timestamp > the term end date", async () => {
      it("should return the full principal and full interest", async () => {
        const [interestAccrued, principalAccrued] = await calculateInterestAndPrincipalAccrued(timestamp.add(new BN(1)))
        expect(interestAccrued).to.bignumber.closeTo(expectedInterest, tolerance)
        expect(principalAccrued).to.bignumber.equal(balance)
      })
    })

    describe("late fees", async () => {
      beforeEach(async () => {
        await creditLine.setInterestAccruedAsOf(timestamp)
        await creditLine.setLastFullPaymentTime(timestamp)
        const offset = lateFeeGracePeriodInDays.mul(SECONDS_PER_DAY).mul(new BN(10))
        await creditLine.setTermEndTime(timestamp.add(offset)) // some time in the future
      })

      it("should not charge late fees within the grace period", async () => {
        const totalInterestPerYear = balance.mul(interestApr).div(INTEREST_DECIMALS)
        let secondsPassed = lateFeeGracePeriodInDays.mul(SECONDS_PER_DAY).div(new BN(2))
        expectedInterest = totalInterestPerYear.mul(secondsPassed).divRound(SECONDS_PER_YEAR)

        const [interestAccrued, principalAccrued] = await calculateInterestAndPrincipalAccrued(
          timestamp.add(secondsPassed)
        )
        expect(interestAccrued).to.bignumber.closeTo(expectedInterest, tolerance)
        expect(principalAccrued).to.bignumber.equal(new BN(0))
      })

      it("should charge late fee apr on the balance and return total interest accrued", async () => {
        const totalInterestPerYear = balance.mul(interestApr).div(INTEREST_DECIMALS)
        let secondsPassed = lateFeeGracePeriodInDays.mul(SECONDS_PER_DAY).mul(new BN(2))
        expectedInterest = totalInterestPerYear.mul(secondsPassed).div(SECONDS_PER_YEAR)

        const lateFeeInterestPerYear = balance.mul(lateFeeApr).div(INTEREST_DECIMALS)
        const lateFee = lateFeeInterestPerYear.mul(secondsPassed).div(SECONDS_PER_YEAR)

        const [interestAccrued, principalAccrued] = await calculateInterestAndPrincipalAccrued(
          timestamp.add(secondsPassed)
        )
        expect(interestAccrued).to.bignumber.closeTo(expectedInterest.add(lateFee), tolerance)
        expect(principalAccrued).to.bignumber.equal(new BN(0))
      })

      it("should not charge late fees on the principal if beyond the term end date", async () => {
        await creditLine.setTermEndTime(timestamp) // Set term end date in the past
        const totalInterestPerYear = balance.mul(interestApr).div(INTEREST_DECIMALS)
        let secondsPassed = lateFeeGracePeriodInDays.mul(SECONDS_PER_DAY).mul(new BN(2))
        expectedInterest = totalInterestPerYear.mul(secondsPassed).div(SECONDS_PER_YEAR)
        const lateFeeInterestPerYear = balance.mul(lateFeeApr).div(INTEREST_DECIMALS)
        const lateFee = lateFeeInterestPerYear.mul(secondsPassed).div(SECONDS_PER_YEAR)

        const [interestAccrued, principalAccrued] = await calculateInterestAndPrincipalAccrued(
          timestamp.add(secondsPassed)
        )
        expect(interestAccrued).to.bignumber.closeTo(expectedInterest.add(lateFee), tolerance)
        expect(principalAccrued).to.bignumber.equal(balance)
      })
    })
  })

  describe("writedowns", async () => {
    let creditLine, balance, interestApr, paymentPeriodInDays, termEndTime, timestamp, gracePeriod, maxLatePeriods

    beforeEach(async () => {
      await setupCreditLine()
    })

    async function setupCreditLine({_paymentPeriodInDays} = {}) {
      balance = usdcVal(10)
      interestApr = interestAprAsBN("3.00")
      const termInDays = new BN(360)
      paymentPeriodInDays = _paymentPeriodInDays || new BN(30)
      gracePeriod = new BN(30)
      maxLatePeriods = new BN(120)
      termEndTime = new BN(Date.now() / 1000) // Current time in seconds
      const lateFeeApr = interestAprAsBN("0")

      creditLine = await CreditLine.new({from: owner})
      await creditLine.initialize(
        goldfinchConfig.address,
        owner,
        borrower,
        bigVal(500),
        interestApr,
        paymentPeriodInDays,
        termInDays,
        lateFeeApr
      )
      await creditLine.setBalance(balance)
      await creditLine.setTermEndTime(termEndTime) // Some time in the future
      timestamp = termEndTime.add(new BN(100)) // Calculate for 100 seconds into the future
      return creditLine
    }

    const interestOwedForOnePeriod = () => {
      const paymentPeriodInSeconds = paymentPeriodInDays.mul(SECONDS_PER_DAY)
      const totalInterestPerYear = balance.mul(interestApr).div(INTEREST_DECIMALS)
      return totalInterestPerYear.mul(paymentPeriodInSeconds).divRound(SECONDS_PER_YEAR)
    }

    const calculateWritedownFor = async (creditline, timestamp, gracePeriod, maxLatePeriods) => {
      const result = await testAccountant.calculateWritedownFor(
        creditline.address,
        timestamp,
        gracePeriod,
        maxLatePeriods
      )
      return [result[0], result[1]]
    }

    describe("calculateAmountOwedForOnePeriod", async () => {
      beforeEach(async () => await setupCreditLine())
      it("calculates amount owed for one period for the credit line", async () => {
        const result = await testAccountant.calculateAmountOwedForOneDay(creditLine.address)
        const calculatedInterestPerDay = new BN(result[0]).div(new BN(ETHDecimals))
        const interestPerDay = interestOwedForOnePeriod().div(paymentPeriodInDays)

        expect(calculatedInterestPerDay).to.bignumber.eq(interestPerDay)
      })
    })

    describe("when the payment period is greater than the max grace period in days", async () => {
      let creditLine
      beforeEach(async () => {
        creditLine = await setupCreditLine({_paymentPeriodInDays: new BN(90)})
      })

      it("should respect the maximum number of grace period days", async () => {
        // With a 30-day max, and 90 day period, then interest owed for one period
        // is equivalent to 3 periods late, which is 3-1 / 4 = 50% writedown
        await creditLine.setInterestOwed(interestOwedForOnePeriod())
        let [writedownPercent, writedownAmount] = await calculateWritedownFor(
          creditLine,
          timestamp,
          gracePeriod,
          maxLatePeriods
        )

        // Should be marked down by 100%
        expect(writedownPercent).to.bignumber.eq("50")
        expect(writedownAmount).to.bignumber.closeTo(balance.div(new BN(2)), tolerance)
      })
    })

    describe("calculateWritedownFor", async () => {
      beforeEach(async () => await setupCreditLine())

      it("does not write down within the grace period", async () => {
        // Only half the interest owed for one period has accumulated, so within grace period
        await creditLine.setInterestOwed(interestOwedForOnePeriod().div(new BN(2)))

        let [writedownPercent, writedownAmount] = await calculateWritedownFor(
          creditLine,
          timestamp,
          gracePeriod,
          maxLatePeriods
        )
        expect(writedownPercent).to.bignumber.eq("0")
        expect(writedownAmount).to.bignumber.eq("0")
      })

      it("writes down proportionally based on interest owed", async () => {
        // 2 periods of interest have accumulated, so we're beyond the grace period.
        await creditLine.setInterestOwed(interestOwedForOnePeriod().mul(new BN(2)))

        let [writedownPercent, writedownAmount] = await calculateWritedownFor(
          creditLine,
          timestamp,
          gracePeriod,
          maxLatePeriods
        )

        // Should be marked down by 25% ((daysLate - grace period) / maxLateDays * 100)
        expect(writedownPercent).to.bignumber.eq("25")
        expect(writedownAmount).to.bignumber.closeTo(balance.div(new BN(4)), tolerance) // 25% of 10
      })

      it("caps the write down to 100% beyond the max late periods", async () => {
        // 13 periods (130 days) of interest have accumulated, so we're beyond the max late days (120)
        await creditLine.setInterestOwed(interestOwedForOnePeriod().mul(new BN(13)))

        let [writedownPercent, writedownAmount] = await calculateWritedownFor(
          creditLine,
          timestamp,
          gracePeriod,
          maxLatePeriods
        )

        // Should be marked down by 100%
        expect(writedownPercent).to.bignumber.eq("100")
        expect(writedownAmount).to.bignumber.eq(balance)
      })

      it("does not write down if there is no balance owed", async () => {
        await creditLine.setBalance(new BN("0"))

        let [writedownPercent, writedownAmount] = await calculateWritedownFor(
          creditLine,
          timestamp,
          gracePeriod,
          maxLatePeriods
        )
        expect(writedownPercent).to.bignumber.eq("0")
        expect(writedownAmount).to.bignumber.eq("0")
      })

      describe("beyond the term end date", async () => {
        it("uses the timestamp to determine if within grace period", async () => {
          const paymentPeriodInSeconds = paymentPeriodInDays.mul(SECONDS_PER_DAY)
          // 50% of one payment period, so within the grace period
          timestamp = termEndTime.add(paymentPeriodInSeconds.div(new BN(2)))
          let [writedownPercent, writedownAmount] = await calculateWritedownFor(
            creditLine,
            timestamp,
            gracePeriod,
            maxLatePeriods
          )
          expect(writedownPercent).to.bignumber.eq("0")
          expect(writedownAmount).to.bignumber.eq("0")
        })

        it("does not go down when you just go over the term end date", async () => {
          await creditLine.setInterestOwed(interestOwedForOnePeriod().mul(new BN(2)))
          timestamp = termEndTime.sub(new BN(2))
          let [writedownPercent, writedownAmount] = await calculateWritedownFor(
            creditLine,
            timestamp,
            gracePeriod,
            maxLatePeriods
          )
          expect(writedownPercent).to.bignumber.eq("25")
          expect(writedownAmount).to.bignumber.eq("2500094")

          timestamp = termEndTime.add(new BN(1))
          let [newWritedownPercent, newWritedownAmount] = await calculateWritedownFor(
            creditLine,
            timestamp,
            gracePeriod,
            maxLatePeriods
          )
          expect(newWritedownPercent).to.bignumber.eq("25")
          expect(newWritedownAmount).to.bignumber.closeTo(writedownAmount, "100")
        })

        it("uses the timestamp to write down proportionally", async () => {
          const paymentPeriodInSeconds = paymentPeriodInDays.mul(SECONDS_PER_DAY)
          // 2 periods late
          timestamp = termEndTime.add(paymentPeriodInSeconds.mul(new BN(2)))
          let [writedownPercent, writedownAmount] = await calculateWritedownFor(
            creditLine,
            timestamp,
            gracePeriod,
            maxLatePeriods
          )
          // Should be marked down by 25% ((periodslate - grace period)/ maxLatePeriods * 100)
          expect(writedownPercent).to.bignumber.eq("25")
          expect(writedownAmount).to.bignumber.eq(balance.div(new BN(4))) // 25% of 10
        })

        it("uses the timestamp to cap max periods late", async () => {
          const paymentPeriodInSeconds = paymentPeriodInDays.mul(SECONDS_PER_DAY)
          // 130 days late
          timestamp = termEndTime.add(paymentPeriodInSeconds.mul(new BN(13)))
          let [writedownPercent, writedownAmount] = await calculateWritedownFor(
            creditLine,
            timestamp,
            gracePeriod,
            maxLatePeriods
          )

          // Should be marked down by 100%
          expect(writedownPercent).to.bignumber.eq("100")
          expect(writedownAmount).to.bignumber.eq(balance)
        })

        it("does not write down if there is no balance owed", async () => {
          await creditLine.setBalance(new BN("0"))
          const paymentPeriodInSeconds = paymentPeriodInDays.mul(SECONDS_PER_DAY)
          // 5 periods later
          timestamp = termEndTime.add(paymentPeriodInSeconds.mul(new BN(5)))

          let [writedownPercent, writedownAmount] = await calculateWritedownFor(
            creditLine,
            timestamp,
            gracePeriod,
            maxLatePeriods
          )
          expect(writedownPercent).to.bignumber.eq("0")
          expect(writedownAmount).to.bignumber.eq("0")
        })
      })
    })
  })

  describe("allocatePayment", async () => {
    const tests = [
      // payment, balance, totalInterestOwed, totalPrincipalOwed, expectedResults
      [10, 40, 10, 20, {interestPayment: 10, principalPayment: 0, additionalBalancePayment: 0}],
      [5, 40, 10, 20, {interestPayment: 5, principalPayment: 0, additionalBalancePayment: 0}],
      [15, 40, 10, 20, {interestPayment: 10, principalPayment: 5, additionalBalancePayment: 0}],
      [35, 40, 10, 20, {interestPayment: 10, principalPayment: 20, additionalBalancePayment: 5}],
      [55, 40, 10, 20, {interestPayment: 10, principalPayment: 20, additionalBalancePayment: 20}],
      [0, 40, 10, 20, {interestPayment: 0, principalPayment: 0, additionalBalancePayment: 0}],
    ]
    mochaEach(tests).it(
      "should calculate things correctly!",
      async (paymentAmount, balance, totalInterestOwed, totalPrincipalOwed, expected) => {
        var result = await accountant.allocatePayment(
          bigVal(paymentAmount),
          bigVal(balance),
          bigVal(totalInterestOwed),
          bigVal(totalPrincipalOwed)
        )

        expect(result.interestPayment).to.be.bignumber.equals(bigVal(expected.interestPayment))
        expect(result.principalPayment).to.be.bignumber.equals(bigVal(expected.principalPayment))
        expect(result.additionalBalancePayment).to.be.bignumber.equals(bigVal(expected.additionalBalancePayment))
      }
    )
  })
})
